import sqlite3
import uuid
from pathlib import Path


class Store:
    def __init__(self, directory: Path):
        self.db = sqlite3.connect(directory / 'devices.sqlite3', check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute('CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL, platform TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)')
        self.db.commit()
        (directory / 'devices.sqlite3').chmod(0o600)

    def list(self):
        return [dict(row) for row in self.db.execute('SELECT * FROM devices ORDER BY created_at, rowid')]

    def get(self, device_id):
        row = self.db.execute('SELECT * FROM devices WHERE id = ?', (device_id,)).fetchone()
        return dict(row) if row else None

    def save(self, device, device_id=None):
        data = device.model_dump()
        if device_id:
            self.db.execute('UPDATE devices SET name=:name, host=:host, port=:port, platform=:platform WHERE id=:id', {**data, 'id': device_id})
        else:
            device_id = uuid.uuid4().hex
            self.db.execute('INSERT INTO devices (id,name,host,port,platform) VALUES (:id,:name,:host,:port,:platform)', {**data, 'id': device_id})
        self.db.commit()
        return self.get(device_id)

    def delete(self, device_id):
        self.db.execute('DELETE FROM devices WHERE id = ?', (device_id,))
        self.db.commit()

    def close(self):
        self.db.close()
