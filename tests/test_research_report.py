import unittest

from shopkud_mcp.server import EvidenceSource, ProductDecision, ResearchSignal, create_service


class ReportBroker:
    def __init__(self):
        self.calls=[]
        self.response=None

    async def call(self,page_id,operation,arguments,timeout=20):
        self.calls.append((page_id,operation,arguments,timeout))
        return self.response or {"ok":True,"report_id":arguments.get("report_id")}


class ResearchReportTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.broker=ReportBroker()
        config={"token":"a"*64,"socket_path":"/private/tmp/native.sock",
                "allowed_origins":["chrome-extension://"+"a"*32+"/"],"tool_profile":"guided"}
        _,mcp,_=create_service(config,self.broker)
        self.tool=mcp._tool_manager._tools["present_research_report"].fn

    async def test_completed_report_is_bounded_and_sent_to_dashboard(self):
        source=EvidenceSource(title="โพสต์สาธารณะบน X",url="https://x.com/example/status/1")
        signal=ResearchSignal(kind="purchase_intent",label="Purchase intent",value="สูง",
                              score=78,rationale="คำถามราคาและประกันเกิดซ้ำ",source_indexes=[0])
        decision=ProductDecision(product_id="10001",status="recommended",
                                 reason="ตรงโจทย์และมีหลักฐานอ้างอิง",source_indexes=[0])
        result=await self.tool(query="ทีวี",stage="recommendation",headline="ทีวีคุ้มกำลังมี purchase intent",
            summary="ผู้ซื้อสนใจราคา ประกัน และความน่าเชื่อถือของร้าน",purchase_intent="เปรียบเทียบก่อนซื้อ",
            confidence="medium",signals=[signal],citations=[source],product_decisions=[decision],trace_id="c"*16)
        self.assertTrue(result["ok"])
        self.assertTrue(result["dashboard_updated"])
        self.assertEqual(len(result["report_id"]),16)
        page,operation,payload,timeout=self.broker.calls[0]
        self.assertEqual((page,operation,timeout),("extension","research_report",3))
        self.assertEqual(payload["signals"][0]["score"],78)
        self.assertEqual(payload["signals"][0]["source_indexes"],[0])
        self.assertEqual(payload["citations"][0]["url"],"https://x.com/example/status/1")
        self.assertEqual(payload["trace_id"],"c"*16)
        self.assertEqual(payload["product_decisions"],[{"product_id":"10001","status":"recommended",
            "reason":"ตรงโจทย์และมีหลักฐานอ้างอิง","source_indexes":[0]}])

    async def test_completed_report_requires_at_least_one_citation(self):
        result=await self.tool(query="ทีวี",stage="trend",headline="กำลังสำรวจตลาด",summary="สรุปชั่วคราว",
                               confidence="low",citations=[])
        self.assertEqual(result["error"],"completed_report_requires_citation")
        self.assertEqual(self.broker.calls,[])

    async def test_completed_report_requires_at_least_one_reason_signal(self):
        source=EvidenceSource(title="หน้าหลักฐาน",url="https://example.com/evidence")
        result=await self.tool(query="ทีวี",stage="recommendation",headline="สรุปตัวเลือก",
                               summary="มีแหล่งข้อมูลแต่ยังไม่มีเหตุผลที่ตรวจสอบได้",
                               confidence="low",citations=[source],signals=[])
        self.assertEqual(result["error"],"completed_report_requires_signal")
        self.assertEqual(self.broker.calls,[])

    async def test_working_report_can_show_progress_before_sources_are_ready(self):
        result=await self.tool(query="ทีวี",status="working",stage="trend",headline="กำลังอ่านสัญญาณตลาด",
                               summary="ยังไม่สรุปผู้ชนะ",confidence="low",citations=[],report_id="b"*16)
        self.assertEqual(result["report_id"],"b"*16)
        self.assertEqual(self.broker.calls[0][2]["status"],"working")

    async def test_product_decisions_reject_duplicates_multiple_winners_and_bad_sources(self):
        source=EvidenceSource(title="หน้าหลักฐาน",url="https://example.com/evidence")
        signal=ResearchSignal(kind="trust",label="ความน่าเชื่อถือ",value="ตรวจแล้ว",
                              rationale="มีหลักฐานร้าน",source_indexes=[0])
        base=dict(query="ทีวี",stage="recommendation",headline="สรุปตัวเลือก",
                  summary="เปรียบเทียบตัวเลือกจากหลักฐาน",confidence="medium",
                  signals=[signal],citations=[source])
        duplicate=[ProductDecision(product_id="10001",status="candidate",reason="ตัวเลือกหนึ่ง"),
                   ProductDecision(product_id="10001",status="rejected",reason="ซ้ำ")]
        self.assertEqual((await self.tool(**base,product_decisions=duplicate))["error"],"duplicate_product_decision")
        multiple=[ProductDecision(product_id="10001",status="recommended",reason="ผู้ชนะหนึ่ง"),
                  ProductDecision(product_id="10002",status="recommended",reason="ผู้ชนะสอง")]
        self.assertEqual((await self.tool(**base,product_decisions=multiple))["error"],"multiple_recommended_products")
        bad_source=[ProductDecision(product_id="10001",status="rejected",reason="อ้างอิงผิด",source_indexes=[1])]
        self.assertEqual((await self.tool(**base,product_decisions=bad_source))["error"],"invalid_source_index")
        self.assertEqual(self.broker.calls,[])

    async def test_dashboard_exposes_decision_run_mismatch_without_retry(self):
        self.broker.response={"ok":False,"error":"decision_run_mismatch"}
        source=EvidenceSource(title="หลักฐาน",url="https://example.com/evidence")
        signal=ResearchSignal(kind="trust",label="ร้าน",value="ตรวจแล้ว",rationale="มีหลักฐาน",source_indexes=[0])
        result=await self.tool(query="ทีวี",stage="recommendation",headline="สรุป",summary="สรุปจากหลักฐาน",
            citations=[source],signals=[signal])
        self.assertEqual(result,{"ok":False,"error":"decision_run_mismatch","retry_automatically":False})


if __name__=="__main__":
    unittest.main()
