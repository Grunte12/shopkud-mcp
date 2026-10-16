import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest

from shopkud_mcp.setup import setup
from shopkud_mcp.server import read_config


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.root=Path(tempfile.mkdtemp(prefix="shopkud-setup-",dir="/private/tmp")).resolve()
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


if __name__=="__main__":unittest.main()
