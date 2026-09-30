"""Publication guards exercise Git staging and a real exported archive."""
from pathlib import Path
import subprocess
import zipfile

import pytest

from scripts.release import ROOT_FILES, ReleaseError, export_source, inspect_source


@pytest.fixture
def project(tmp_path):
    for name in ROOT_FILES:
        (tmp_path / name).write_text('', encoding='utf-8')
    source = Path(__file__).resolve().parents[1]
    (tmp_path / '.gitignore').write_bytes((source / '.gitignore').read_bytes())
    (tmp_path / 'README.md').write_text('A public project.\n')
    return tmp_path


def run_git(root, *args):
    subprocess.run(['git', '-C', str(root), *args], check=True, capture_output=True)


def test_source_zip_excludes_private_files_and_is_reproducible(project):
    private = {
        '.env': 'PRIVATE_ORIGIN=private deployment',
        '.data/access-key': 'local-' + 'secret-' * 6,
        '.data/devices.sqlite3': 'private database',
        '.context/history.md': 'private notes',
        'artifacts/screen.png': 'private screenshot',
        'dist/index.html': 'private deployment build',
    }
    for name, value in private.items():
        path = project / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)
    files = inspect_source(project)
    first, second = project / 'release/one.zip', project / 'release/two.zip'
    export_source(files, first)
    export_source(inspect_source(project), second)
    assert first.read_bytes() == second.read_bytes()
    with zipfile.ZipFile(first) as archive:
        assert set(archive.namelist()) == {'taildesk/' + name for name in ROOT_FILES}
        assert archive.read('taildesk/README.md') == b'A public project.\n'
    assert not (project / '.git').exists()
    assert all((project / name).read_text() == value for name, value in private.items())


def test_tracked_private_file_is_rejected_even_when_gitignored(project):
    run_git(project, 'init', '--quiet')
    (project / '.env').write_text('PRIVATE_ORIGIN=private deployment')
    run_git(project, 'add', '-f', '.env')
    with pytest.raises(ReleaseError, match='outside public source allowlist'):
        inspect_source(project)


def test_staged_secret_is_rejected_after_working_file_is_cleaned(project):
    run_git(project, 'init', '--quiet')
    secret = 'ghp_' + 'A' * 36
    (project / 'README.md').write_text(secret)
    run_git(project, 'add', 'README.md')
    (project / 'README.md').write_text('clean working tree')
    with pytest.raises(ReleaseError, match=r'\(index\): access token') as error:
        inspect_source(project)
    assert secret not in str(error.value)


def test_symlinks_are_not_followed(project, tmp_path_factory):
    outside = tmp_path_factory.mktemp('private') / 'note'
    outside.write_text('sensitive data')
    link = project / 'docs/note.md'
    link.parent.mkdir()
    link.symlink_to(outside)
    with pytest.raises(ReleaseError, match='symbolic link'):
        inspect_source(project)


def test_exact_local_access_key_leak_is_blocked_without_echo(project):
    secret = b'local-random-key-' + b'123abc' * 5
    (project / '.data').mkdir()
    (project / '.data/access-key').write_bytes(secret)
    (project / 'README.md').write_bytes(b'Do not publish: ' + secret)
    with pytest.raises(ReleaseError, match='local access key') as error:
        inspect_source(project)
    assert secret.decode() not in str(error.value)


@pytest.mark.parametrize('text,reason', [
    ('https://' + 'private-host.private-tailnet' + '.ts.net', 'non-example tailnet hostname'),
    ('100.' + '90.80.70', 'non-example tailnet IPv4'),
    ('/Users/' + 'private-person/work', 'personal home path'),
])
def test_private_metadata_is_rejected(project, text, reason):
    (project / 'README.md').write_text(text)
    with pytest.raises(ReleaseError, match=reason) as error:
        inspect_source(project)
    assert text not in str(error.value)


def test_binary_file_and_unknown_root_file_require_review(project):
    (project / 'docs').mkdir()
    (project / 'docs/image.md').write_bytes(b'\x89PNG\0\xff')
    (project / 'personal-notes.txt').write_text('unreviewed')
    with pytest.raises(ReleaseError) as error:
        inspect_source(project)
    assert 'binary/non-UTF-8' in str(error.value)
    assert 'outside public source allowlist' in str(error.value)
