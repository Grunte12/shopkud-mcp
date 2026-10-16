import copy
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest

from mcp.server.fastmcp.exceptions import ToolError
from shopkud_mcp.server import create_service, read_config
from shopkud_mcp.setup import enable_workspace

PAGE="1:"+"a"*32
SOURCE="b"*32
WS="c"*32
RECORD={"product_id":"123","name":"สินค้าตัวอย่าง","product_url":"https://affiliate.shopee.co.th/offer/product_offer/123","price_min_thb":100,"price_max_thb":100,"commission_pct":7,"sold":10,"mall":True,"extra_comm":False}
PICK={"product_id":"123","reason":"เหตุผลที่ตรวจได้","content_angle":"ฉากตัวอย่าง","risks":[],"confidence":"medium","evidence":[{"url":"https://example.test/source","title":"หลักฐานทดสอบ"}]}


class Broker:
    def __init__(self):self.calls=[];self.response={"ok":True,"records":[RECORD],"observed_at":"2026-10-07T00:00:00Z"}
    async def call(self,page_id,operation,arguments,timeout=20):
        self.calls.append((page_id,operation,arguments,timeout));return copy.deepcopy(self.response)


class Workspace:
    def __init__(self):self.observations=[];self.saved=[];self.reads=[]
    def observe(self,records,observed_at=None):self.observations.append((records,observed_at));return {"ok":True}
    def save_workspace(self,*args,**kwargs):self.saved.append((args,kwargs));return {"ok":True,"workspace_id":WS}
    def get_workspace(self,*args,**kwargs):self.reads.append((args,kwargs));return {"ok":True,"workspace_id":WS}


class Campaign:
    def __init__(self):self.calls=[]
    def get_links(self,*args,**kwargs):self.calls.append(("links",args,kwargs));return {"ok":True}
    def get_report(self,*args,**kwargs):self.calls.append(("report",args,kwargs));return {"ok":True}
    def set_link(self,*args,**kwargs):self.calls.append(("link",args,kwargs));return {"ok":True}
    def import_csv(self,*args,**kwargs):self.calls.append(("import",args,kwargs));return {"ok":True,"committed":kwargs.get("commit",False)}


class WorkspaceToolsTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.root=Path(tempfile.mkdtemp(prefix="shopkud-tools-",dir="/private/tmp")).resolve()
        self.config={"token":"a"*64,"socket_path":str(self.root/"native.sock"),"port":8176,"allowed_origins":["chrome-extension://"+"a"*32+"/"]}
        self.broker=Broker();self.workspace=Workspace();self.campaign=Campaign()
        _,self.mcp,_=create_service(self.config,self.broker,self.workspace,self.campaign)
        self.tools=self.mcp._tool_manager._tools
    def tearDown(self):shutil.rmtree(self.root)
    def tool(self,name):return self.tools[name].fn

    async def test_workspace_disabled_by_default_does_not_call_native_or_create_storage(self):
        _,mcp,_=create_service(self.config,self.broker)
        result=await mcp._tool_manager._tools["save_workspace"].fn("ชื่อ",{})
        self.assertEqual(result["error"],"workspace_disabled");self.assertEqual(list(self.root.iterdir()),[]);self.assertEqual(self.broker.calls,[])

    async def test_brief_update_does_not_replace_saved_records_or_read_browser(self):
        await self.tool("save_workspace")("ชุดงาน",{"audience":"ไทย"},workspace_id=WS,expected_version=2)
        args,kwargs=self.workspace.saved[0];self.assertIsNone(args[3]);self.assertEqual(kwargs,{"expected_version":2});self.assertEqual(self.broker.calls,[])

    async def test_snapshot_source_only_reads_cached_export_and_separates_analysis(self):
        await self.tool("save_workspace")("ชุด",{},page_id=PAGE,source_type="snapshot",source_id=SOURCE,product_ids=["123"],analysis={"123":{"reason":"ตัวอย่าง"}})
        self.assertEqual(self.broker.calls[0][1],"export");records=self.workspace.saved[0][0][3]
        self.assertEqual(records[0]["observed_at"],"2026-10-07T00:00:00Z");self.assertIn("agent_analysis",records[0]);self.assertNotIn("agent_analysis",self.workspace.observations[0][0][0])

    async def test_review_source_preserves_human_choice_as_metadata_not_observed_fact(self):
        self.broker.response={"ok":True,"schema_version":1,"kind":"shopkud_review_bundle","view":"full","records":[{"observation":RECORD,"analysis":PICK}],"decision":{"kept_product_ids":[]},"observed_at":"2026-10-07T00:00:00Z"}
        result=await self.tool("save_workspace")("ชุด",{},page_id=PAGE,source_type="review",source_id=SOURCE)
        self.assertTrue(result["ok"]);self.assertEqual(self.workspace.saved[0][0][3][0]["human_kept"],False);self.assertNotIn("human_kept",self.workspace.observations[0][0][0])

    async def test_missing_product_and_out_of_source_analysis_never_save(self):
        for kwargs,error in [({"product_ids":["999"]},"product_not_in_source"),({"analysis":{"999":{}}},"analysis_product_not_in_source")]:
            result=await self.tool("save_workspace")("ชุด",{},page_id=PAGE,source_type="snapshot",source_id=SOURCE,**kwargs);self.assertEqual(result["error"],error)
        self.assertEqual(self.workspace.saved,[])

    async def test_multi_id_reads_are_local_and_bounds_are_strict(self):
        await self.tool("get_workspace")(view="products",product_ids=["123","456"],limit=2)
        self.assertEqual(self.broker.calls,[]);self.assertEqual(self.workspace.reads[-1][1]["product_ids"],["123","456"])
        for args in [{"product_ids":["123","123"]},{"limit":True},{"offset":1000}]:
            self.assertEqual((await self.tool("get_workspace")(**args))["error"],"invalid_input")

    async def test_complete_native_reads_capture_history_but_brief_scan_does_not_fake_source_url(self):
        await self.tool("get_products")(PAGE)
        self.assertEqual(len(self.workspace.observations),1)
        self.broker.response={"ok":True,"query":"","view":"brief","records":[{"product_id":"123"}]}
        await self.tool("get_scan_products")(PAGE,SOURCE,view="brief")
        self.assertEqual(len(self.workspace.observations),1)

    async def test_typed_selection_schema_and_invalid_probability_do_not_reach_extension(self):
        schema=self.tools["prepare_selection"].parameters
        self.assertEqual(schema["$defs"]["AnalysisPick"]["properties"]["confidence"]["enum"],["low","medium","high"])
        bad={**PICK,"confidence":0.9,"reason":"private marker"}
        result=await self.tool("prepare_selection")(PAGE,SOURCE,[bad]);self.assertEqual(result["error"],"invalid_analysis_plan");self.assertNotIn("private marker",json.dumps(result));self.assertEqual(self.broker.calls,[])
        await self.tool("prepare_selection")(PAGE,SOURCE,[PICK]);self.assertEqual(self.broker.calls[0][2]["picks"],[PICK])

    async def test_report_defaults_preview_and_rejects_non_boolean_commit(self):
        await self.tool("import_report_csv")(WS,"sub,amount\na,1",{"sub_id":"sub","commission":"amount"},"shopee","2026-10-01","2026-10-07")
        self.assertFalse(self.campaign.calls[0][2]["commit"])
        result=await self.tool("import_report_csv")(WS,"s,c",{},"shopee","2026-10-01","2026-10-07",commit="yes");self.assertEqual(result["error"],"invalid_input")
        with self.assertRaises(ToolError):await self.mcp._tool_manager.call_tool("import_report_csv",{"workspace_id":WS,"csv_text":"s,c","mapping":{},"marketplace":"shopee","period_start":"2026-10-01","period_end":"2026-10-07","commit":"yes"})

    async def test_private_csv_intake_reads_only_named_owner_placed_files(self):
        intake=self.root/"imports";intake.mkdir(mode=0o700)
        target=intake/"report.csv";target.write_text("sub,amount\na,1",encoding="utf-8");target.chmod(0o600)
        result=await self.tool("import_report_csv")(WS,None,{},"shopee","2026-10-01","2026-10-07",csv_file="report.csv")
        self.assertTrue(result["ok"]);self.assertEqual(self.campaign.calls[0][1][1],"sub,amount\na,1")
        for filename in ["../config.json","/private/tmp/report.csv","missing.csv"]:
            self.assertFalse((await self.tool("import_report_csv")(WS,None,{},"shopee","2026-10-01","2026-10-07",csv_file=filename))["ok"])
        target.chmod(0o644);self.assertFalse((await self.tool("import_report_csv")(WS,None,{},"shopee","2026-10-01","2026-10-07",csv_file="report.csv"))["ok"])

    async def test_opt_in_preserves_private_credentials_and_makes_private_intake(self):
        path=self.root/"config.json";path.write_text(json.dumps(self.config));path.chmod(0o600)
        enable_workspace(path);after=read_config(path)
        self.assertTrue(after.pop("workspace_enabled"));self.assertEqual(after,self.config);self.assertEqual((self.root/"imports").stat().st_mode&0o777,0o700)
        backups=list(self.root.glob("config-before-workspace-*.json"));self.assertEqual(len(backups),1);self.assertEqual(json.loads(backups[0].read_text()),self.config)
        enable_workspace(path);self.assertEqual(len(list(self.root.glob("config-before-workspace-*.json"))),1)
