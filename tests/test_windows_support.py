"""Focused Windows install/runtime checks; executed on a real Windows runner."""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from shopkud_mcp.campaigns import CampaignStore
from shopkud_mcp.server import read_config
from shopkud_mcp.setup import install_windows_startup, setup_windows
from shopkud_mcp.workspace import AnalysisStore
from tests.test_setup import FakeRegistry


@unittest.skipUnless(sys.platform=="win32","Windows-only acceptance checks")
class WindowsSupportTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix="shopkud-windows-")
        self.local=Path(self.temp.name)/"LocalAppData";self.local.mkdir()
        self.environment=patch.dict(os.environ,{"LOCALAPPDATA":str(self.local)})
        self.environment.start()

    def tearDown(self):
        self.environment.stop();self.temp.cleanup()

    def test_console_host_setup_startup_and_embedded_stores(self):
        host=shutil.which("shopkud-native-host")
        self.assertIsNotNone(host,"wheel did not install the Windows native-host executable")
        registry=FakeRegistry()
        def free_port():
            with socket.socket() as listener:
                listener.bind(("127.0.0.1",0));return listener.getsockname()[1]
        port=free_port();native_port=free_port()
        while native_port==port:native_port=free_port()
        config_path=setup_windows("b"*32,port=port,native_port=native_port,
                                  host_executable=host,registry_module=registry)
        config=read_config(config_path)
        self.assertEqual(config["native_port"],native_port)
        processes=[]
        def start(*args,**kwargs):
            process=subprocess.Popen(*args,**kwargs);processes.append(process);return process
        try:
            result=install_windows_startup(config_path,sys.executable,
                                           registry_module=registry,popen=start)
            self.assertEqual(result["state"],"running")
            for _ in range(100):
                try:
                    with socket.create_connection(("127.0.0.1",port),timeout=0.1):break
                except OSError:time.sleep(0.05)
            else:self.fail("Windows worker did not bind its loopback MCP port")
            AnalysisStore(config_path.parent)
            CampaignStore(config_path.parent)
        finally:
            for process in processes:
                process.terminate();process.wait(timeout=5)


if __name__=="__main__":unittest.main()
