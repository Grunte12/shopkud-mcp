import asyncio
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import struct
import tempfile
import unittest

from shopkud_mcp.broker import BrokerError
from shopkud_mcp.server import GUIDED_TOOLS, read_config, BearerAuth, create_service


class ConfigTests(unittest.TestCase):
    def setUp(self):
        self.root=Path(tempfile.mkdtemp(prefix="shopkud-config-")).resolve()
        self.path=self.root/"config.json"
        self.config={"token":"a"*64,"port":8176,"socket_path":str(self.root/"native.sock"),"allowed_origins":["chrome-extension://"+"a"*32+"/"]}
        self.write()
    def tearDown(self): shutil.rmtree(self.root)
    def write(self):
        self.path.write_text(json.dumps(self.config));self.path.chmod(0o600)
    def test_private_config(self): self.assertEqual(read_config(self.path),self.config)
    def test_public_file_rejected(self):
        self.path.chmod(0o644)
        with self.assertRaises(ValueError):read_config(self.path)
    def test_public_directory_rejected(self):
        self.root.chmod(0o755)
        with self.assertRaises(ValueError):read_config(self.path)
    def test_symlink_and_hardlink_rejected(self):
        link=self.root/"link.json";link.symlink_to(self.path)
        with self.assertRaises(ValueError):read_config(link)
        link.unlink();os.link(self.path,link)
        with self.assertRaises(ValueError):read_config(self.path)
    def test_outside_socket_rejected(self):
        self.config["socket_path"]=str(Path(tempfile.gettempdir())/"shopkud-elsewhere.sock");self.write()
        with self.assertRaises(ValueError):read_config(self.path)
    def test_wildcard_origin_rejected(self):
        self.config["allowed_origins"]=["chrome-extension://*/"];self.write()
        with self.assertRaises(ValueError):read_config(self.path)
    def test_extra_config_key_rejected(self):
        self.config["shell"]="anything";self.write()
        with self.assertRaises(ValueError):read_config(self.path)
    def test_tool_profile_is_bounded(self):
        for profile in ("guided","full"):
            self.config["tool_profile"]=profile;self.write()
            self.assertEqual(read_config(self.path)["tool_profile"],profile)
        self.config["tool_profile"]="everything";self.write()
        with self.assertRaises(ValueError):read_config(self.path)


class AuthTests(unittest.IsolatedAsyncioTestCase):
    async def invoke(self,headers):
        output=[];called=[]
        async def app(scope,receive,send):called.append(True)
        async def send(message):output.append(message)
        await BearerAuth(app,"a"*64)({"type":"http","headers":headers},None,send)
        return output,called
    async def test_missing_and_wrong_credentials(self):
        for headers in [[],[(b"authorization",b"Bearer wrong")]]:
            output,called=await self.invoke(headers);self.assertFalse(called);self.assertEqual(output[0]["status"],401)
    async def test_browser_origin_rejected_even_with_token(self):
        output,called=await self.invoke([(b"authorization",b"Bearer "+b"a"*64),(b"origin",b"https://example.test")])
        self.assertFalse(called);self.assertEqual(output[0]["status"],401)
    async def test_explicit_token_forwarded(self):
        output,called=await self.invoke([(b"authorization",b"Bearer "+b"a"*64)])
        self.assertTrue(called);self.assertEqual(output,[])


PAGE_ID="123:"+"a"*32
SCAN_ID="b"*32


class RecordingBroker:
    def __init__(self):
        self.calls=[]
        self.error=None
        self.response=None
    def pages(self): return []
    async def call(self,page_id,operation,arguments,timeout=20):
        self.calls.append((page_id,operation,arguments,timeout))
        if self.error:
            raise BrokerError(self.error)
        if self.response is not None:
            return self.response
        return {"ok":True,"operation":operation}


class PaginationToolsTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.broker=RecordingBroker()
        self.config={"token":"a"*64,"socket_path":str(Path(tempfile.gettempdir())/"shopkud-server-native.sock"),
                     "allowed_origins":["chrome-extension://"+"a"*32+"/"]}
        _,self.mcp,_=create_service(self.config,self.broker)
        self.tools=self.mcp._tool_manager._tools

    def tool(self,name): return self.tools[name].fn

    async def test_query_and_brief_schema_are_bounded_without_new_tools(self):
        schema=self.tools['get_scan_products'].parameters['properties']
        self.assertEqual(schema['query']['maxLength'],120)
        self.assertEqual(schema['view']['enum'],['full','brief'])
        self.assertEqual(len(self.tools),58)
        self.assertIn("selector_health", self.tools)
        self.assertIn("get_offer", self.tools)
        self.assertIn("find_link", self.tools)
        self.assertIn("suggest_replacement", self.tools)
        self.assertIn("reload_extension", self.tools)

    async def test_guided_profile_exposes_workflows_not_browser_primitives(self):
        config={**self.config,"tool_profile":"guided"}
        _,mcp,_=create_service(config,self.broker)
        self.assertEqual(set(mcp._tool_manager._tools),GUIDED_TOOLS)
        self.assertEqual(len(mcp._tool_manager._tools),19)
        self.assertIn("rank_affiliate_products",mcp._tool_manager._tools)
        self.assertIn("get_product_history",mcp._tool_manager._tools)
        self.assertNotIn("find_link",mcp._tool_manager._tools)
        self.assertNotIn("scan_products",mcp._tool_manager._tools)
        self.assertNotIn("go_to_page",mcp._tool_manager._tools)
        self.assertIn("guided profile intentionally hides",mcp.instructions)
        self.assertNotIn("go_to_page",mcp.instructions)
        def catalog_bytes(service):
            rows=[{"name":tool.name,"description":tool.description,"inputSchema":tool.parameters}
                  for tool in service._tool_manager._tools.values()]
            return len(json.dumps(rows,ensure_ascii=False,separators=(",",":")).encode())
        self.assertLess(catalog_bytes(mcp),catalog_bytes(self.mcp)*0.4)

    async def test_reload_extension_routes_only_the_idle_extension_target(self):
        self.broker.response={"ok":True,"status":"reloading","extension_version":"0.11.0"}
        result=await self.tool("reload_extension")()
        self.assertEqual(result["status"],"reloading")
        self.assertEqual(self.broker.calls,[("extension","reload_extension",{},5)])

    async def test_selector_health_strips_values_and_does_not_click(self):
        self.broker.response={
            "ok":True,
            "opens_links":False,
            "clicked":False,
            "pii":False,
            "page_kind":"detail",
            "checks":[{
                "id":"create_button","status":"matched","count":1,"method":"accessible_name",
                "evidence":"cited","pattern_ids":["sg_get_link"],"label":"buyer@example.com",
            }],
            "short_link_count":2,
            "href":"https://s.shopee.co.th/SecretCode1",
            "buyer_email":"buyer@example.com",
        }
        result=await self.tool("selector_health")(PAGE_ID)
        encoded=json.dumps(result)
        self.assertNotIn("buyer@example.com", encoded)
        self.assertNotIn("SecretCode1", encoded)
        self.assertEqual(result["opens_links"], False)
        self.assertEqual(result["clicked"], False)
        self.assertEqual(result["pii"], False)
        self.assertEqual(result["checks"][0]["pattern_ids"], ["sg_get_link"])
        self.assertEqual(self.broker.calls, [(PAGE_ID, "selector_health", {}, 15)])
        self.broker.calls.clear()
        self.broker.response={"ok":True,"clicked":True,"opens_links":False,"buyer_email":"buyer@example.com"}
        refused=await self.tool("selector_health")(PAGE_ID)
        self.assertEqual(refused["error"], "diagnostic_not_read_only")
        self.assertNotIn("buyer@example.com", json.dumps(refused))

    async def test_review_schema_is_strict_bounded_and_defaults_to_brief(self):
        schema=self.tools['get_review_plan'].parameters['properties']
        self.assertEqual(schema['view']['enum'],['brief','full'])
        self.assertEqual(schema['view']['default'],'brief')
        self.assertEqual((schema['limit']['minimum'],schema['limit']['maximum']),(1,20))
        self.assertEqual((schema['offset']['minimum'],schema['offset']['maximum']),(0,19))
        self.assertEqual(schema['plan_id']['pattern'],r'^[0-9a-f]{32}$')

    async def test_review_routes_one_read_and_attests_bundle(self):
        self.broker.response={'ok':True,'schema_version':1,'kind':'shopkud_review_bundle','view':'brief','records':[]}
        result=await self.tool('get_review_plan')(PAGE_ID,SCAN_ID,10,0,'brief')
        self.assertEqual(result,self.broker.response)
        self.assertEqual(self.broker.calls,[(PAGE_ID,'review',{'plan_id':SCAN_ID,'limit':10,'offset':0,'view':'brief'},20)])

    async def test_invalid_review_requests_never_reach_broker(self):
        for plan_id,limit,offset,view in [('bad',10,0,'brief'),(SCAN_ID,True,0,'brief'),(SCAN_ID,21,0,'brief'),(SCAN_ID,10,20,'brief'),(SCAN_ID,10,0,'ranked')]:
            result=await self.tool('get_review_plan')(PAGE_ID,plan_id,limit,offset,view)
            self.assertEqual(result,{'ok':False,'error':'invalid_input'})
        self.assertEqual(self.broker.calls,[])

    async def test_review_does_not_claim_support_from_old_extension(self):
        result=await self.tool('get_review_plan')(PAGE_ID,SCAN_ID)
        self.assertEqual(result['error'],'extension_upgrade_required')
        self.assertEqual(result['retry_automatically'],False)

    async def test_review_errors_preserved_and_never_marked_as_actions(self):
        self.broker.error='disconnected'
        result=await self.tool('get_review_plan')(PAGE_ID,SCAN_ID)
        self.assertEqual(result,{'ok':False,'error':'disconnected','outcome':'not_completed','retry_automatically':False})

    async def test_apply_version_routes_only_when_supplied_and_is_strict(self):
        await self.tool('apply_selection')(PAGE_ID,SCAN_ID)
        await self.tool('apply_selection')(PAGE_ID,SCAN_ID,3)
        self.assertEqual(self.broker.calls,[(PAGE_ID,'apply',{'plan_id':SCAN_ID},20),(PAGE_ID,'apply',{'plan_id':SCAN_ID,'expected_decision_version':3},20)])
        for version in [True,-1,1000001,'3']:
            self.assertEqual(await self.tool('apply_selection')(PAGE_ID,SCAN_ID,version),{'ok':False,'error':'invalid_input'})
        self.assertEqual(len(self.broker.calls),2)

    async def test_filtered_brief_read_routes_once_and_attests_extension_support(self):
        self.broker.response={'ok':True,'query':'Keychron','view':'brief','total':1,'unfiltered_total':100,'records':[]}
        result=await self.tool('get_scan_products')(PAGE_ID,SCAN_ID,20,0,'Keychron','brief')
        self.assertEqual(result,self.broker.response)
        self.assertEqual(self.broker.calls,[(PAGE_ID,'scan_read',{'scan_id':SCAN_ID,'limit':20,'offset':0,'query':'Keychron','view':'brief'},20)])

    async def test_old_extension_cannot_silently_claim_query_or_brief_support(self):
        result=await self.tool('get_scan_products')(PAGE_ID,SCAN_ID,20,0,'Keychron','brief')
        self.assertEqual(result,{'ok':False,'error':'extension_upgrade_required','outcome':'not_completed','retry_automatically':False})
        self.assertEqual(len(self.broker.calls),1)

    async def test_invalid_query_and_view_never_reach_broker(self):
        for query,view in [(True,'full'),('x'*121,'full'),('ok','ranked'),('ok',False)]:
            result=await self.tool('get_scan_products')(PAGE_ID,SCAN_ID,20,0,query,view)
            self.assertEqual(result,{'ok':False,'error':'invalid_input'})
        self.assertEqual(self.broker.calls,[])

    async def test_cached_read_error_is_preserved_not_masked_as_upgrade(self):
        self.broker.response={'ok':False,'error':'scan_context_changed'}
        self.assertEqual(await self.tool('get_scan_products')(PAGE_ID,SCAN_ID,20,0,'Keychron','brief'),self.broker.response)

    async def test_four_tools_publish_bounded_schemas_and_safety_descriptions(self):
        expected={"get_pagination","go_to_page","scan_products","get_scan_products"}
        self.assertTrue(expected.issubset(self.tools))
        go_schema=self.tools["go_to_page"].parameters["properties"]
        self.assertEqual((go_schema["page_number"]["minimum"],go_schema["page_number"]["maximum"]),(1,10000))
        scan_schema=self.tools["scan_products"].parameters["properties"]
        self.assertEqual((scan_schema["start_page"]["minimum"],scan_schema["start_page"]["maximum"]),(1,10000))
        self.assertEqual((scan_schema["max_pages"]["minimum"],scan_schema["max_pages"]["maximum"]),(1,20))
        self.assertEqual((scan_schema["max_products"]["minimum"],scan_schema["max_products"]["maximum"]),(1,1000))
        read_schema=self.tools["get_scan_products"].parameters["properties"]
        self.assertEqual((read_schema["limit"]["minimum"],read_schema["limit"]["maximum"]),(1,50))
        self.assertEqual((read_schema["offset"]["minimum"],read_schema["offset"]["maximum"]),(0,999))
        self.assertEqual(read_schema["scan_id"]["pattern"],r"^[0-9a-f]{32}$")
        self.assertIn("Refuses while site selections",self.tools["go_to_page"].description)
        self.assertIn("ต้องอ่าน get_products สด",self.tools["scan_products"].description)
        self.assertIn("bounded chunk",self.tools["get_scan_products"].description)

    async def test_routes_exact_arguments_and_scan_gets_longer_timeout(self):
        self.assertEqual(await self.tool("get_pagination")(PAGE_ID),{"ok":True,"operation":"pagination"})
        self.assertEqual(await self.tool("go_to_page")(PAGE_ID,7),{"ok":True,"operation":"navigate"})
        self.assertEqual(
            await self.tool("scan_products")(PAGE_ID,3,5,250),
            {"ok":True,"operation":"scan"},
        )
        self.assertEqual(
            await self.tool("get_scan_products")(PAGE_ID,SCAN_ID,40,800),
            {"ok":True,"operation":"scan_read"},
        )
        self.assertEqual(self.broker.calls,[
            (PAGE_ID,"pagination",{},20),
            (PAGE_ID,"navigate",{"page_number":7},20),
            (PAGE_ID,"scan",{"start_page":3,"max_pages":5,"max_products":250},90),
            (PAGE_ID,"scan_read",{"scan_id":SCAN_ID,"limit":40,"offset":800},20),
        ])

    async def test_invalid_bounds_types_and_ids_do_not_reach_broker(self):
        invalid_calls=[
            ("get_pagination",("not-a-page-id",)),
            ("go_to_page",(PAGE_ID,0)),
            ("go_to_page",(PAGE_ID,10001)),
            ("go_to_page",(PAGE_ID,True)),
            ("scan_products",(PAGE_ID,0,10,100)),
            ("scan_products",(PAGE_ID,1,21,100)),
            ("scan_products",(PAGE_ID,1,10,1001)),
            ("scan_products",(PAGE_ID,True,10,100)),
            ("get_scan_products",(PAGE_ID,"not-hex",30,0)),
            ("get_scan_products",(PAGE_ID,SCAN_ID,0,0)),
            ("get_scan_products",(PAGE_ID,SCAN_ID,30,1000)),
            ("get_scan_products",(PAGE_ID,SCAN_ID,True,0)),
        ]
        for name,args in invalid_calls:
            with self.subTest(tool=name,args=args):
                result=await self.tool(name)(*args)
                self.assertEqual(result,{"ok":False,"error":"invalid_input"})
        self.assertEqual(self.broker.calls,[])

    async def test_mcp_schema_rejects_coercible_booleans_and_out_of_range_values(self):
        invalid=[
            ("go_to_page",{"page_id":PAGE_ID,"page_number":True}),
            ("go_to_page",{"page_id":PAGE_ID,"page_number":10001}),
            ("scan_products",{"page_id":PAGE_ID,"start_page":True}),
            ("scan_products",{"page_id":PAGE_ID,"max_pages":21}),
            ("scan_products",{"page_id":PAGE_ID,"max_products":1001}),
            ("get_scan_products",{"page_id":PAGE_ID,"scan_id":SCAN_ID,"limit":True}),
            ("get_scan_products",{"page_id":PAGE_ID,"scan_id":SCAN_ID,"offset":1000}),
            ("get_scan_products",{"page_id":PAGE_ID,"scan_id":SCAN_ID,"query":True}),
            ("get_scan_products",{"page_id":PAGE_ID,"scan_id":SCAN_ID,"query":"x"*121}),
            ("get_scan_products",{"page_id":PAGE_ID,"scan_id":SCAN_ID,"view":"ranked"}),
        ]
        for name,arguments in invalid:
            with self.subTest(tool=name,arguments=arguments):
                try:
                    await self.mcp._tool_manager.call_tool(name,arguments)
                except Exception as error:
                    self.assertEqual(type(error).__name__,"ToolError")
                else:
                    self.fail("MCP schema must reject invalid arguments before function execution")
        self.assertTrue(self.broker.calls)
        self.assertTrue(all(call[0]=="extension" and call[1]=="developer_event" for call in self.broker.calls))
        events=[call[2] for call in self.broker.calls]
        self.assertEqual(sum(event["phase"]=="started" for event in events),len(invalid))
        self.assertEqual(sum(event["phase"]=="failed" for event in events),len(invalid))

    async def test_uncertain_navigation_and_scan_are_never_marked_retryable(self):
        self.broker.error="timeout"
        for name,args,operation in [
            ("go_to_page",(PAGE_ID,8),"navigate"),
            ("scan_products",(PAGE_ID,),"scan"),
        ]:
            with self.subTest(tool=name):
                result=await self.tool(name)(*args)
                self.assertEqual(result,{"ok":False,"error":"timeout","outcome":"unconfirmed","retry_automatically":False})
        self.assertEqual([call[1] for call in self.broker.calls],["navigate","scan"])
        self.assertEqual([call[3] for call in self.broker.calls],[20,90])


spec=importlib.util.spec_from_file_location("native_host",Path(__file__).parents[1]/"shopkud_mcp/native_host.py")
native=importlib.util.module_from_spec(spec);spec.loader.exec_module(native)
class FramingTests(unittest.TestCase):
    def test_fragmented_header_and_payload(self):
        class Fragmented(io.BytesIO):
            def read(self,size=-1):return super().read(min(size,1))
        raw=io.BytesIO();native.write_frame(raw,{"type":"fixture"})
        self.assertEqual(native.read_frame(Fragmented(raw.getvalue())),{"type":"fixture"})
    def test_partial_write(self):
        class Partial(io.BytesIO):
            def write(self,value):return super().write(value[:2])
        raw=Partial();native.write_frame(raw,{"type":"fixture"})
        self.assertEqual(native.read_frame(io.BytesIO(raw.getvalue())),{"type":"fixture"})
    def test_oversized_and_truncated_rejected(self):
        for raw in [struct.pack("=I",native.MAX+1),b"\x01",struct.pack("=I",20)+b"{}"]:
            with self.assertRaises(ValueError):native.read_frame(io.BytesIO(raw))
    def test_non_object_rejected(self):
        with self.assertRaises(ValueError):native.read_frame(io.BytesIO(struct.pack("=I",2)+b"[]"))


if __name__=="__main__":unittest.main()
