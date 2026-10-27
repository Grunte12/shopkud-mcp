import asyncio
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch, AsyncMock, Mock

import httpx

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from shopkud_mcp.client import ensure_worker
from shopkud_mcp.portable import install


class PortableClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_windows_closed_port_timeout_still_starts_worker(self):
        with tempfile.TemporaryDirectory() as directory:
            path=install("abcdefghijklmnopabcdefghijklmnop",Path(directory).resolve(),18276)
            response=Mock()
            response.json.return_value={"result":{"serverInfo":{"name":"ShopKud MCP"}}}
            client=AsyncMock()
            client.post.side_effect=[httpx.ConnectTimeout("closed loopback port"),response]
            with patch("shopkud_mcp.client.httpx.AsyncClient") as factory, patch("shopkud_mcp.client.subprocess.Popen") as spawn:
                factory.return_value.__aenter__.return_value=client
                await ensure_worker(path)
                spawn.assert_called_once()

    async def test_autostart_shared_worker_and_stdio_schema(self):
        processes=[]
        popen=subprocess.Popen
        def capture(*args,**kwargs):
            process=popen(*args,**kwargs)
            processes.append(process)
            return process
        with tempfile.TemporaryDirectory() as directory:
            with socket.socket() as reserve:
                reserve.bind(("127.0.0.1",0))
                port=reserve.getsockname()[1]
            path=install("abcdefghijklmnopabcdefghijklmnop",Path(directory).resolve(),port)
            try:
                with patch("shopkud_mcp.client.subprocess.Popen",side_effect=capture):
                    first=await ensure_worker(path)
                    second=await ensure_worker(path)
                self.assertEqual(first,second)
                self.assertEqual(len(processes),1)
                params=StdioServerParameters(command=sys.executable,args=["-m","shopkud_mcp.server","connect","--config",str(path)])
                async with stdio_client(params) as (read,write):
                    async with ClientSession(read,write) as client:
                        initialized=await client.initialize()
                        self.assertIn("get_workflow_guide",initialized.instructions)
                        self.assertEqual(len((await client.list_tools()).tools),19)
                        result=await client.call_tool("get_workflow_guide",{})
                        self.assertFalse(result.isError)
                self.assertIsNone(processes[0].poll(),"one client closing must not kill the shared worker")
            finally:
                for process in processes:
                    if process.poll() is None:
                        process.terminate()
                        await asyncio.to_thread(process.wait,timeout=10)


if __name__=="__main__":
    unittest.main()
