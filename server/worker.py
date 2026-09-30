"""websockify entry point with a bounded downstream connect timeout.

Unreachable sleeping devices must not leave a worker blocked in TCP connect
after the browser has already closed or retried its session.
"""
import socket

from websockify import websocketproxy, websockifyserver

original_socket = websockifyserver.WebSockifyServer.socket


def bounded_socket(host, port=None, connect=False, prefer_ipv6=False, **options):
    if connect and not options.get('unix_socket') and not options.get('use_ssl'):
        client = socket.create_connection((host, int(port)), timeout=5)
        client.settimeout(None)
        client.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
        return client
    return original_socket(host, port, connect=connect, prefer_ipv6=prefer_ipv6, **options)


if __name__ == '__main__':
    websockifyserver.WebSockifyServer.socket = staticmethod(bounded_socket)
    websocketproxy.websockify_init()
