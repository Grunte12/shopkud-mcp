"""Stdio entry point for MCP clients; all clients share one loopback worker."""
import asyncio
import subprocess
import sys

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.server import Server
from mcp.server.stdio import stdio_server

from .server import read_config


async def ensure_worker(path):
    config = read_config(path)
    endpoint = f"http://127.0.0.1:{config['port']}/mcp"
    headers = {"Authorization": "Bearer " + config["token"],
               "Accept":"application/json, text/event-stream"}
    request = {"jsonrpc":"2.0", "id":1, "method":"initialize", "params":{
        "protocolVersion":"2025-11-25", "capabilities":{},
        "clientInfo":{"name":"shopkud-launcher","version":"1"}}}
    process = None
    async with httpx.AsyncClient(headers=headers, timeout=2, trust_env=False) as client:
        for _ in range(80):
            try:
                response = await client.post(endpoint, json=request)
                response.raise_for_status()
                result = response.json()
                if "result" not in result or result["result"].get("serverInfo",{}).get("name") != "ShopKud MCP":
                    raise ValueError("unexpected_worker")
                return config
            except (httpx.ConnectError, httpx.ConnectTimeout):
                if process is None:
                    options = {"creationflags":subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS} if sys.platform=="win32" else {"start_new_session":True}
                    process = subprocess.Popen([sys.executable,"-m","shopkud_mcp.server","serve","--config",str(path)],
                        stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,**options)
                await asyncio.sleep(0.1)
        raise ValueError("worker_start_timeout")


async def connect(path):
    config = await ensure_worker(path)
    proxy = Server("ShopKud")
    async with httpx.AsyncClient(headers={"Authorization":"Bearer "+config["token"]},trust_env=False,timeout=150) as http:
        async with streamable_http_client(f"http://127.0.0.1:{config['port']}/mcp", http_client=http) as (read,write,_):
            async with ClientSession(read,write) as session:
                initialized = await session.initialize()
                proxy.instructions = initialized.instructions

                @proxy.list_tools()
                async def list_tools():
                    return (await session.list_tools()).tools

                @proxy.call_tool(validate_input=False)
                async def call_tool(name,arguments):
                    return await session.call_tool(name,arguments)

                async with stdio_server() as (incoming,outgoing):
                    await proxy.run(incoming,outgoing,proxy.create_initialization_options())


async def pair(path):
    import webbrowser
    config = await ensure_worker(path)
    async with httpx.AsyncClient(headers={"Authorization":"Bearer "+config["token"]},trust_env=False,timeout=5) as client:
        response = await client.post(f"http://127.0.0.1:{config['port']}/setup/pair")
        response.raise_for_status()
    url = config["allowed_origins"][0]+f"pair.html?port={config['port']}"
    # Single-use bootstrap proof, never the MCP bearer or durable extension key.
    # The extension removes the fragment immediately, before user approval.
    opened=webbrowser.open(url+"#"+response.json()["nonce"])
    return {"pairing_open_seconds":120,"browser_open_requested":opened,"approval_page":url}
