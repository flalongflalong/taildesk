#!/usr/bin/env python3
"""Check the current public source set; optionally export a deterministic ZIP.

No network, commits, history rewriting, or secret values in diagnostic output.
This is a project-specific guard, not a complete secret/history scanner.
"""
import argparse
from contextlib import contextmanager
import ipaddress
from pathlib import Path, PurePosixPath
import re
import subprocess
import tempfile
import zipfile

ROOT_FILES = {
    '.env.example', '.gitignore', '.gitattributes', '.prettierignore',
    '.prettierrc.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
    'SECURITY.md', 'CONTRIBUTING.md', 'package.json', 'package-lock.json',
    'requirements.txt', 'index.html', 'tsconfig.json', 'vite.config.ts',
}
SOURCE_TYPES = {
    'src': {'.ts', '.tsx', '.css'}, 'server': {'.py'},
    'scripts': {'.py', '.mjs', '.sh'}, 'tests': {'.py', '.mjs'},
    'public': {'.svg', '.webmanifest'}, 'docs': {'.md'},
}
PRIVATE_PARTS = {
    '.git', '.data', '.context', '.codex', '.agents', '.venv', 'node_modules',
    'artifacts', 'dist', 'release', '__pycache__', '.pytest_cache', 'bridge-tokens',
}
PRIVATE_SUFFIXES = {'.log', '.db', '.pem', '.key', '.p12', '.pfx', '.pyc'}
SYNTHETIC_IPS = {'100.64.0.0', '100.64.0.1', '100.64.0.10', '100.127.255.255'}
PATTERNS = {
    'private-key material': re.compile(r'-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----'),
    'access token': re.compile(
        r'\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{30,}'
        r'|tskey-(?:auth|api)-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}'
        r'|AKIA[A-Z0-9]{16})\b'),
    'personal home path': re.compile(r'(?:/(?:Users|home)/[A-Za-z0-9_.-]+|[A-Z]:\\Users\\[A-Za-z0-9_.-]+)'),
    'tunnel hostname': re.compile(r'\b[\w-]+\.(?:ngrok-free\.app|ngrok-free\.dev|ngrok\.io|trycloudflare\.com)\b'),
}


class ReleaseError(Exception):
    pass


def public_path(name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or any(p in PRIVATE_PARTS for p in path.parts):
        return False
    if any(p.startswith('.env') and p != '.env.example' for p in path.parts):
        return False
    if path.name == 'access-key' or path.suffix in PRIVATE_SUFFIXES or '.sqlite' in path.name:
        return False
    if name in ROOT_FILES:
        return True
    if len(path.parts) < 2 or any(p.startswith('.') for p in path.parts[1:]):
        return False
    if path.parts[0] == 'licenses':
        return True
    if path.parts[:2] == ('.github', 'workflows'):
        return path.suffix in {'.yml', '.yaml'}
    return path.suffix in SOURCE_TYPES.get(path.parts[0], set())


def content_issues(name, data, local_keys=()):
    issues = []
    if any(key and key in data for key in local_keys):
        issues.append('local access key')
    try:
        value = data.decode('utf-8')
    except UnicodeDecodeError:
        return issues + ['binary/non-UTF-8 file requires manual review']
    if '\0' in value:
        issues.append('binary file requires manual review')
    issues.extend(label for label, pattern in PATTERNS.items() if pattern.search(value))
    for host in re.findall(r'\b[\w.-]+\.ts\.net\b', value):
        if host == 'example.ts.net' or host.endswith('.example.ts.net'):
            continue
        issues.append('non-example tailnet hostname')
        break
    for address in re.findall(r'(?<![\w.])100\.\d{1,3}\.\d{1,3}\.\d{1,3}(?![\w.])', value):
        try:
            tailnet = ipaddress.ip_address(address) in ipaddress.ip_network('100.64.0.0/10')
        except ValueError:
            continue
        if tailnet and address not in SYNTHETIC_IPS:
            issues.append('non-example tailnet IPv4')
            break
    for address in re.findall(r'\bfd7a:115c:a1e0:[0-9a-f:]+', value, re.I):
        if name == 'tests/test_gateway.py' and address.endswith(':5900'):
            address = address.rsplit(':', 1)[0]  # Synthetic websockify token fixture.
        if address.lower() not in {'fd7a:115c:a1e0::', 'fd7a:115c:a1e0::1'}:
            issues.append('non-example tailnet IPv6')
            break
    return list(dict.fromkeys(issues))


def git(command, *args):
    result = subprocess.run([*command, *args], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    if result.returncode:
        raise ReleaseError('Git candidate inspection failed; no archive created.')
    return result.stdout


@contextmanager
def git_view(root):
    probe = subprocess.run(['git', '-C', str(root), 'rev-parse', '--show-toplevel'],
                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    if probe.returncode == 0:
        if Path(probe.stdout.decode().strip()).resolve() != root:
            raise ReleaseError('Project must be the Git root; review the parent repository separately.')
        yield ['git', '-C', str(root)], True
    else:
        # A temporary index evaluates .gitignore even before the first git init.
        with tempfile.TemporaryDirectory(prefix='taildesk-release-git-') as temp:
            git(['git'], 'init', '--bare', '--quiet', temp)
            yield ['git', '--git-dir', temp, '--work-tree', str(root),
                   '-c', 'core.excludesFile=/dev/null'], False


def inspect_source(root):
    root = root.resolve()
    # Compare local keys only in memory; never add them to diagnostics or archives.
    local_keys = []
    for path in (root / '.data').glob('**/access-key'):
        if not path.is_symlink() and path.is_file():
            key = path.read_bytes().strip()
            if key:
                local_keys.append(key)
    issues, files = [], {}
    with git_view(root) as (command, has_repository):
        names = sorted(set(git(command, 'ls-files', '--cached', '--others', '--exclude-standard', '-z')
                           .decode().strip('\0').split('\0')) - {''})
        for name in names:
            if not public_path(name):
                issues.append(f'{name!r}: outside public source allowlist')
                continue
            path = root / name
            if path.is_symlink() or any(p.is_symlink() for p in path.parents if p != root):
                issues.append(f'{name!r}: symbolic link')
                continue
            if not path.is_file():
                issues.append(f'{name!r}: tracked file missing from working tree')
                continue
            data = path.read_bytes()
            files[name] = data
            issues.extend(f'{name!r}: {reason}' for reason in content_issues(name, data, local_keys))
        if has_repository:
            for entry in git(command, 'ls-files', '--stage', '-z').decode().split('\0'):
                if not entry:
                    continue
                metadata, name = entry.split('\t', 1)
                mode, oid, stage = metadata.split()
                if not public_path(name) or mode not in {'100644', '100755'} or stage != '0':
                    issues.append(f'{name!r}: private/unsupported/conflicted index entry')
                    continue
                data = git(command, 'cat-file', 'blob', oid)
                issues.extend(f'{name!r} (index): {reason}' for reason in content_issues(name, data, local_keys))
    for required in sorted(ROOT_FILES - files.keys()):
        issues.append(f'{required!r}: required public file missing')
    if issues:
        raise ReleaseError('\n'.join(dict.fromkeys(issues)))
    return files


def export_source(files, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo('taildesk/' + name, date_time=(2026, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--export', type=Path, help='Write the checked working source to this ZIP.')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    try:
        if args.export:
            destination = args.export.absolute()
            # Refuse replacing source/config files or following an output symlink.
            if destination.suffix != '.zip' or destination.exists() and not destination.is_file():
                raise ReleaseError('Export destination must be a regular .zip file.')
            if destination.is_symlink() or any(p.is_symlink() for p in destination.parents):
                raise ReleaseError('Export destination must not use symbolic links.')
        files = inspect_source(root)
        if args.export:
            export_source(files, destination)
        print(f'PASS: {len(files)} public text files checked (working tree and available Git index).')
        if args.export:
            print('Source ZIP written. No local configuration, runtime data, images, or Git history included.')
        return 0
    except (ReleaseError, OSError) as error:
        # OSError messages may contain private absolute paths; suppress their detail.
        print(str(error) if isinstance(error, ReleaseError) else 'File/Git operation failed; no publish approval implied.')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
