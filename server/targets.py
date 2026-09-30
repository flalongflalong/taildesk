import asyncio
import ipaddress
import re
import socket

V4 = ipaddress.ip_network('100.64.0.0/10')
V6 = ipaddress.ip_network('fd7a:115c:a1e0::/48')


def allowed_ip(value: str) -> bool:
    try:
        address = ipaddress.ip_address(value)
        return address in (V4 if address.version == 4 else V6) or value in {'127.0.0.1', '::1'}
    except ValueError:
        return False


def validate_host(value: str) -> str:
    value = value.strip().lower()
    if allowed_ip(value):
        return str(ipaddress.ip_address(value))
    if len(value) <= 253 and value.endswith('.ts.net') and all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', part) for part in value.split('.')):
        return value
    raise ValueError('请输入 Tailscale IP、完整的 .ts.net 名称，或网关本机 127.0.0.1 / ::1')


async def resolve_target(host: str, port: int) -> str:
    validate_host(host)
    if not 5900 <= port <= 5999:
        raise ValueError('仅支持 VNC 端口 5900–5999')
    if allowed_ip(host):
        return host
    addresses = await asyncio.wait_for(asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM), 5)
    ips = list(dict.fromkeys(entry[4][0] for entry in addresses))
    # MagicDNS may never resolve to loopback or another private/public network.
    if not ips or any(not allowed_ip(ip) or ip in {'127.0.0.1', '::1'} for ip in ips):
        raise ValueError('该名称未解析到 Tailscale 地址，请检查 MagicDNS 或直接填写 Tailscale IP')
    return ips[0]
