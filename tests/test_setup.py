import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from shopkud_mcp.setup import (
    _probe_worker,
    install_macos_service,
    install_windows_startup,
    set_tool_profile,
    setup,
    setup_windows,
)
from shopkud_mcp.server import read_config


class FakeRegistry:
    HKEY_CURRENT_USER="HKCU"
    REG_SZ=1
    def __init__(self):self.values={}
    class Key:
        def __init__(self,registry,path):self.registry,self.path=registry,path
        def __enter__(self):return self
        def __exit__(self,*_args):return False
    def OpenKey(self,_root,path):
        if not any(key[0]==path for key in self.values):raise FileNotFoundError(path)
        return self.Key(self,path)
    def CreateKey(self,_root,path):return self.Key(self,path)
    def QueryValueEx(self,key,name):
        lookup=(key.path,name)
        if lookup not in self.values:raise FileNotFoundError(lookup)
        return self.values[lookup],self.REG_SZ
    def SetValueEx(self,key,name,_reserved,_kind,value):self.values[(key.path,name)]=value


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.root=Path(tempfile.mkdtemp(prefix="shopkud-setup-")).resolve()
        self.state=self.root/"private"
        self.manifests=self.root/"manifests"
        self.extension="b"*32
    def tearDown(self):shutil.rmtree(self.root)
    def install(self):return setup(self.extension,self.state,self.manifests)
    def test_setup_is_private_and_idempotent(self):
        config=self.install();original=config.read_bytes();self.assertEqual(self.install(),config)
        self.assertEqual(config.read_bytes(),original)
        self.assertEqual(self.state.stat().st_mode&0o777,0o700)
        self.assertEqual(config.stat().st_mode&0o777,0o600)
        self.assertEqual((self.state/"native-launcher").stat().st_mode&0o777,0o700)
        self.assertEqual(read_config(config)["allowed_origins"],["chrome-extension://"+self.extension+"/"])
        self.assertEqual(read_config(config)["tool_profile"],"guided")
        manifest=json.loads((self.manifests/"org.shopkud.mcp.json").read_text())
        self.assertEqual(manifest["allowed_origins"],["chrome-extension://"+self.extension+"/"])
        self.assertNotIn(read_config(config)["token"],(self.state/"native-launcher").read_text())
    def test_mismatched_existing_origin_does_not_rotate_key(self):
        config=self.install();original=config.read_bytes()
        with self.assertRaises(ValueError):setup("c"*32,self.state,self.manifests)
        self.assertEqual(config.read_bytes(),original)
    def test_public_state_refused(self):
        self.state.mkdir(mode=0o755)
        with self.assertRaises(ValueError):self.install()
    def test_existing_foreign_manifest_preserved(self):
        self.manifests.mkdir();target=self.manifests/"org.shopkud.mcp.json";target.write_text('{"foreign":true}')
        with self.assertRaises(ValueError):self.install()
        self.assertEqual(target.read_text(),'{"foreign":true}')
        self.assertFalse((self.state/"config.json").exists())
        self.assertFalse((self.state/"native-host.py").exists())
    def test_foreign_manifest_does_not_update_runtime(self):
        self.install();target=self.manifests/"org.shopkud.mcp.json"
        native=self.state/"native-host.py";native.write_text("operator sentinel")
        target.write_text('{"foreign":true}')
        with self.assertRaises(ValueError):self.install()
        self.assertEqual(native.read_text(),"operator sentinel")
    def test_hardlinked_manifest_refused(self):
        self.install();target=self.manifests/"org.shopkud.mcp.json"
        os.link(target,self.root/"linked-manifest")
        with self.assertRaises(ValueError):self.install()
    def test_hardlinked_native_target_not_overwritten(self):
        self.install();target=self.state/"native-host.py";outside=self.root/"outside.py";os.link(target,outside)
        original=outside.read_bytes()
        with self.assertRaises(ValueError):self.install()
        self.assertEqual(outside.read_bytes(),original)
    def test_extension_wildcard_refused(self):
        with self.assertRaises(ValueError):setup("*",self.state,self.manifests)

    def test_macos_service_is_private_idempotent_and_starts_once(self):
        config=self.install();launch=self.root/"launch-agents";python=Path(__import__("sys").executable)
        responses=[SimpleNamespace(returncode=1),SimpleNamespace(returncode=0)]
        with patch("shopkud_mcp.setup.sys.platform","darwin"), patch(
                "shopkud_mcp.setup.subprocess.run",side_effect=responses) as run:
            result=install_macos_service(config,launch,python)
        target=launch/"org.shopkud.mcp.plist"
        self.assertEqual((result["state"],target.stat().st_mode&0o777),("running",0o600))
        self.assertEqual(run.call_count,2)
        original=target.read_bytes()
        with patch("shopkud_mcp.setup.sys.platform","darwin"), patch(
                "shopkud_mcp.setup.subprocess.run",return_value=SimpleNamespace(returncode=0)):
            again=install_macos_service(config,launch,python)
        self.assertEqual(again["state"],"already_running")
        self.assertEqual(target.read_bytes(),original)

    def test_macos_service_refuses_foreign_existing_target(self):
        config=self.install();launch=self.root/"launch-agents";launch.mkdir()
        target=launch/"org.shopkud.mcp.plist";target.write_text("foreign")
        with patch("shopkud_mcp.setup.sys.platform","darwin"), self.assertRaises(ValueError):
            install_macos_service(config,launch,Path(__import__("sys").executable),start=False)

    def test_tool_profile_switch_preserves_credentials(self):
        config=self.install();before=read_config(config)
        set_tool_profile(config,"full")
        after=read_config(config)
        self.assertEqual(after["tool_profile"],"full")
        self.assertEqual({k:v for k,v in after.items() if k!="tool_profile"},
                         {k:v for k,v in before.items() if k!="tool_profile"})
        set_tool_profile(config,"full")
        with self.assertRaises(ValueError):set_tool_profile(config,"invalid")

    def test_windows_setup_registers_private_native_host_and_is_idempotent(self):
        local=self.root/"local-app-data";local.mkdir()
        host=self.root/"shopkud-native-host.exe";host.write_bytes(b"launcher")
        registry=FakeRegistry()
        with patch.dict(os.environ,{"LOCALAPPDATA":str(local)}), patch(
                "shopkud_mcp.setup.sys.platform","win32"):
            config=setup_windows(self.extension,host_executable=host,registry_module=registry)
            original=config.read_bytes()
            self.assertEqual(setup_windows(self.extension,host_executable=host,registry_module=registry),config)
            parsed=read_config(config)
        self.assertEqual(config.read_bytes(),original)
        self.assertEqual((parsed["port"],parsed["native_port"],parsed["tool_profile"]),(8176,8177,"guided"))
        manifest=json.loads((config.parent/"org.shopkud.mcp.json").read_text())
        self.assertEqual(manifest["path"],str(host.absolute()))
        self.assertNotIn(parsed["token"],json.dumps(manifest))
        self.assertEqual(registry.values[(r"Software\Google\Chrome\NativeMessagingHosts\org.shopkud.mcp",None)],
                         str(config.parent/"org.shopkud.mcp.json"))

    def test_windows_startup_uses_private_config_without_bearer_in_registry(self):
        local=self.root/"local-app-data";local.mkdir()
        host=self.root/"shopkud-native-host.exe";host.write_bytes(b"launcher")
        python=self.root/"python.exe";python.write_bytes(b"python")
        pythonw=self.root/"pythonw.exe";pythonw.write_bytes(b"pythonw")
        registry=FakeRegistry()
        process=SimpleNamespace(poll=lambda:None)
        with patch.dict(os.environ,{"LOCALAPPDATA":str(local)}), patch(
                "shopkud_mcp.setup.sys.platform","win32"):
            config=setup_windows(self.extension,host_executable=host,registry_module=registry)
            with patch("shopkud_mcp.setup.socket.create_connection",side_effect=OSError), patch(
                    "shopkud_mcp.setup._probe_worker",side_effect=[False,True]):
                result=install_windows_startup(config,python,start=True,registry_module=registry,popen=lambda *a,**k:process)
            token=read_config(config)["token"]
        command=registry.values[(r"Software\Microsoft\Windows\CurrentVersion\Run","ShopKudMCP")]
        self.assertEqual(result["state"],"running")
        self.assertIn("shopkud_mcp.server",command)
        self.assertNotIn(token,command)

    def test_windows_startup_reuses_only_authenticated_worker(self):
        local=self.root/"local-app-data";local.mkdir()
        host=self.root/"shopkud-native-host.exe";host.write_bytes(b"launcher")
        python=self.root/"python.exe";python.write_bytes(b"python")
        registry=FakeRegistry()
        with patch.dict(os.environ,{"LOCALAPPDATA":str(local)}), patch(
                "shopkud_mcp.setup.sys.platform","win32"):
            config=setup_windows(self.extension,host_executable=host,registry_module=registry)
            with patch("shopkud_mcp.setup._probe_worker",return_value=True), patch(
                    "shopkud_mcp.setup.subprocess.Popen") as popen:
                result=install_windows_startup(config,python,start=True,registry_module=registry)
        self.assertEqual(result["state"],"already_running")
        popen.assert_not_called()

    def test_windows_startup_refuses_foreign_process_on_worker_port(self):
        local=self.root/"local-app-data";local.mkdir()
        host=self.root/"shopkud-native-host.exe";host.write_bytes(b"launcher")
        python=self.root/"python.exe";python.write_bytes(b"python")
        registry=FakeRegistry()
        connection=unittest.mock.MagicMock()
        connection.__enter__.return_value=connection
        with patch.dict(os.environ,{"LOCALAPPDATA":str(local)}), patch(
                "shopkud_mcp.setup.sys.platform","win32"):
            config=setup_windows(self.extension,host_executable=host,registry_module=registry)
            with patch("shopkud_mcp.setup._probe_worker",return_value=False), patch(
                    "shopkud_mcp.setup.socket.create_connection",return_value=connection), patch(
                    "shopkud_mcp.setup.subprocess.Popen") as popen, self.assertRaisesRegex(
                    OSError,"worker_port_in_use"):
                install_windows_startup(config,python,start=True,registry_module=registry)
        popen.assert_not_called()

    def test_worker_probe_requires_shopkud_identity(self):
        class Response:
            status=200
            def __init__(self,name):self.name=name
            def read(self,_limit):
                return json.dumps({"result":{"serverInfo":{"name":self.name}}}).encode()
        class Connection:
            def __init__(self,name):self.name=name
            def request(self,*_args,**_kwargs):pass
            def getresponse(self):return Response(self.name)
            def close(self):pass
        config={"port":8176,"token":"a"*64}
        with patch("shopkud_mcp.setup.http.client.HTTPConnection",return_value=Connection("Other MCP")):
            self.assertFalse(_probe_worker(config))
        with patch("shopkud_mcp.setup.http.client.HTTPConnection",return_value=Connection("ShopKud MCP")):
            self.assertTrue(_probe_worker(config))


if __name__=="__main__":unittest.main()
