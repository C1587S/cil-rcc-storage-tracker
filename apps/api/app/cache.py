"""Small thread-safe LRU cache for immutable snapshot query results.

Snapshot data never changes for a given snapshot_date, so responses keyed by
(snapshot_date, ...) can be cached indefinitely; old entries fall out via LRU
as new snapshot dates arrive.
"""
from collections import OrderedDict
from threading import Lock


class LRUCache:
    def __init__(self, maxsize: int = 2048):
        self.maxsize = maxsize
        self._data: OrderedDict = OrderedDict()
        self._lock = Lock()

    def get(self, key):
        with self._lock:
            if key in self._data:
                self._data.move_to_end(key)
                return self._data[key]
            return None

    def put(self, key, value) -> None:
        with self._lock:
            self._data[key] = value
            self._data.move_to_end(key)
            if len(self._data) > self.maxsize:
                self._data.popitem(last=False)
