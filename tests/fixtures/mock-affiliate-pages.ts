/**
 * Faithful mocks of Shopee Affiliate pages for testing
 * 
 * These mocks simulate the actual UI and behavior of:
 * - Custom Link creation page (ลิงก์ที่กำหนดเอง)
 * - Product Offer detail page
 * - Reports page
 */

import express from 'express';
import type { Server } from 'http';
import { pathToFileURL } from 'url';

export interface MockAffiliateState {
  createCalls: number;
  offerDetailCalls: number;
  reportExportCalls: number;
  reportListCalls: number;
}

export function createMockAffiliateServer() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const state: MockAffiliateState = {
    createCalls: 0,
    offerDetailCalls: 0,
    reportExportCalls: 0,
    reportListCalls: 0,
  };
  const links = new Map<string, any>();

  app.get('/fixture/captcha', (_req, res) => {
    res.send(`<!DOCTYPE html><html><body>
      <h1>Verify</h1>
      <iframe src="/captcha/frame" title="captcha" style="width:320px;height:120px;display:block"></iframe>
    </body></html>`);
  });

  app.get('/captcha/frame', (_req, res) => {
    res.send('<html><body>captcha</body></html>');
  });

  app.get('/fixture/empty', (_req, res) => {
    res.send('<!DOCTYPE html><html><body><h1>Empty</h1></body></html>');
  });

  app.get('/fixture/login', (_req, res) => {
    res.send(`<!DOCTYPE html><html><body>
      <form class="login-form">
        <input type="text" name="loginKey">
        <input type="password" name="password">
        <button type="button">เข้าสู่ระบบ</button>
      </form>
    </body></html>`);
  });

  // Custom Link page
  app.get('/offer/custom_link', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <title>ลิงก์ที่กำหนดเอง - Shopee Affiliate</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
    .form-group { margin-bottom: 15px; }
    label { display: block; margin-bottom: 5px; font-weight: bold; }
    input[type="text"] { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
    button { padding: 10px 20px; background: #ee4d2d; color: white; border: none; border-radius: 4px; cursor: pointer; }
    button:hover { background: #d73211; }
    .error-message { color: red; padding: 10px; display: none; }
    [role="dialog"] { display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 30px; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 1000; min-width: 400px; }
    [role="dialog"].visible { display: block; }
    .overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 999; }
    .overlay.visible { display: block; }
    textarea[readonly] { width: 100%; padding: 10px; margin: 15px 0; border: 1px solid #ddd; border-radius: 4px; background: #f5f5f5; font-family: monospace; }
  </style>
</head>
<body>
  <h1>ลิงก์ที่กำหนดเอง (Custom Link)</h1>
  <form id="custom-link-form">
    <div class="form-group">
      <label for="product-url">ลิงก์สินค้า</label>
      <textarea id="product-url" placeholder="https://shopee.co.th/" required></textarea>
    </div>
    <div class="form-group">
      <label for="customLink_sub_id1">Sub_id 1</label>
      <input type="text" id="customLink_sub_id1" placeholder="ตัวอย่าง: SportShoes">
    </div>
    <div class="form-group">
      <label for="customLink_sub_id2">Sub_id 2</label>
      <input type="text" id="customLink_sub_id2" placeholder="ตัวอย่าง: InstagramFeed">
    </div>
    <div class="form-group">
      <label for="customLink_sub_id3">Sub_id 3</label>
      <input type="text" id="customLink_sub_id3" placeholder="ตัวอย่าง: 1212BirthdaySale">
    </div>
    <div class="form-group">
      <label for="customLink_sub_id4">Sub_id 4</label>
      <input type="text" id="customLink_sub_id4" placeholder="กรุณายืนยัน">
    </div>
    <div class="form-group">
      <label for="customLink_sub_id5">Sub_id 5</label>
      <input type="text" id="customLink_sub_id5" placeholder="กรุณายืนยัน">
    </div>
    <div class="error-message"></div>
    <button type="submit">เอา ลิงก์</button>
  </form>

  <div class="overlay"></div>
  <div role="dialog">
    <h3>ลิงก์ของคุณ (Your Link)</h3>
    <textarea readonly rows="3"></textarea>
    <button onclick="document.querySelector('[role=dialog]').classList.remove('visible'); document.querySelector('.overlay').classList.remove('visible');">ปิด</button>
  </div>

  <script>
    document.getElementById('custom-link-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = {
        productUrl: document.getElementById('product-url').value,
        subId1: document.getElementById('customLink_sub_id1').value,
        subId2: document.getElementById('customLink_sub_id2').value,
        subId3: document.getElementById('customLink_sub_id3').value,
        subId4: document.getElementById('customLink_sub_id4').value,
        subId5: document.getElementById('customLink_sub_id5').value,
      };
      
      const errorEl = document.querySelector('.error-message');
      errorEl.style.display = 'none';
      errorEl.textContent = '';

      // Validate product URL (slug -i.shop.item or /product/shop/item)
      if (!data.productUrl || !data.productUrl.match(/shopee\\.co\\.th\\/(?:.*-i\\.\\d+\\.\\d+|product\\/\\d+\\/\\d+)/)) {
        errorEl.textContent = 'Invalid product URL format';
        errorEl.style.display = 'block';
        return;
      }

      try {
        const response = await fetch('/api/v4/affiliate/custom_link/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });

        const result = await response.json();
        
        if (result.ok && result.short_link) {
          document.querySelector('[role="dialog"] textarea').value = result.short_link;
          document.querySelector('[role="dialog"]').classList.add('visible');
          document.querySelector('.overlay').classList.add('visible');
        } else {
          errorEl.textContent = result.error || 'Failed to create link';
          errorEl.style.display = 'block';
        }
      } catch (error) {
        errorEl.textContent = 'Network error: ' + error.message;
        errorEl.style.display = 'block';
      }
    });
  </script>
</body>
</html>
    `);
  });

  // API endpoint for custom link creation
  app.post('/api/v4/affiliate/custom_link/create', (req, res) => {
    state.createCalls += 1;
    const { productUrl, subId1, subId2, subId3, subId4, subId5 } = req.body;

    const slug = String(productUrl || '').match(/shopee\.co\.th\/.*-i\.(\d+)\.(\d+)/);
    const product = String(productUrl || '').match(/shopee\.co\.th\/product\/(\d+)\/(\d+)/);
    const match = slug || product;
    if (!match) {
      return res.json({ ok: false, error: 'Invalid product URL' });
    }

    const [, shopId, itemId] = match;
    const linkId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const shortLink = `https://s.shopee.co.th/${Math.random().toString(36).substring(2, 10)}`;

    const link = {
      id: linkId,
      short_link: shortLink,
      product_url: productUrl,
      item_id: itemId,
      shop_id: shopId,
      sub_ids: { subId1, subId2, subId3, subId4, subId5 },
      created_at: new Date().toISOString(),
    };

    links.set(linkId, link);

    setTimeout(() => {
      res.json({
        ok: true,
        short_link: shortLink,
        data: link,
      });
    }, 50);
  });

  // Product Offer detail page
  app.get('/offer/product_offer/:itemId', (req, res) => {
    const { itemId } = req.params;
    
    res.send(`
<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <title>Product Offer ${itemId} - Shopee Affiliate</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; }
    .detail-info { max-width: 800px; margin: 0 auto; }
    .name-wrap { margin-bottom: 20px; }
    .name { font-size: 24px; font-weight: bold; margin-bottom: 10px; }
    .price { font-size: 20px; color: #ee4d2d; margin: 10px 0; }
    button { padding: 10px 20px; background: #ee4d2d; color: white; border: none; border-radius: 4px; cursor: pointer; margin-top: 20px; }
    button:hover { background: #d73211; }
    [role="dialog"] { display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 30px; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 1000; }
    [role="dialog"].visible { display: block; }
    [role="dialog"] h4 { margin: 0 0 15px 0; }
    [role="dialog"] textarea { width: 400px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; background: #f5f5f5; font-family: monospace; }
    .overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 999; }
    .overlay.visible { display: block; }
    table { margin: 20px 0; border-collapse: collapse; width: 100%; }
    th, td { padding: 10px; text-align: left; border: 1px solid #ddd; }
    th { background: #f5f5f5; font-weight: bold; }
  </style>
</head>
<body>
  <main>
    <div class="detail-info">
      <div class="name-wrap">
        <div class="name">Mock Product ${itemId} สินค้าทดสอบ</div>
        <a href="https://shopee.co.th/product/12345/${itemId}">ดูสินค้า</a>
      </div>
      <span class="price">฿299.00 - ฿599.00</span>

      <table>
        <thead>
          <tr>
            <th>ประเภทช่องทาง</th>
            <th>ค่าคอมช้อปปี้</th>
            <th>ค่าคอมมิชชั่นโดยประมาณ</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>โซเชียลมีเดีย</td>
            <td>10%</td>
            <td>฿29.90 - ฿59.90</td>
          </tr>
          <tr>
            <td>ช้อปปี้ไลฟ์</td>
            <td>12%</td>
            <td>฿35.88 - ฿71.88</td>
          </tr>
        </tbody>
      </table>

      <button id="get-link">เอา ลิงก์</button>
    </div>

    <div class="overlay"></div>
    <div role="dialog">
      <h4>ลิงก์ข้อเสนอสินค้า</h4>
      <textarea disabled rows="3"></textarea>
      <br><br>
      <button onclick="document.querySelector('[role=dialog]').classList.remove('visible'); document.querySelector('.overlay').classList.remove('visible');">ปิด</button>
    </div>
  </main>

  <script>
    document.getElementById('get-link').addEventListener('click', async () => {
      const shortLink = 'https://s.shopee.co.th/mock${itemId}test';
      document.querySelector('[role="dialog"] textarea').value = shortLink;
      document.querySelector('[role="dialog"]').classList.add('visible');
      document.querySelector('.overlay').classList.add('visible');

    });

    fetch('/api/v3/offer/product?item_id=${itemId}', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
  </script>
</body>
</html>
    `);
  });

  // API endpoint for offer detail
  app.get('/api/v3/offer/product', (req, res) => {
    state.offerDetailCalls += 1;
    const itemId = String(req.query.item_id || '');

    res.json({
      code: 0,
      msg: 'success',
      data: {
        item_id: itemId,
        commission_rate: {
          seller_commission_rate: '10%',
          shopee_commission_rate: '2%',
          default_commission_rate: '12%',
        },
        commission_rate_detail: {
          default_commission_rate: 12000,
          seller_commission_rate: 10000,
          shopee_commission_rate: 2000,
          social_media_check_out_base_commission_rate: 600,
        },
        batch_item_for_item_card_full: {
          name: `Mock Product ${itemId}`,
          price: '29900000',
          price_min: '29900000',
          price_max: '59900000',
          shopid: '12345',
          stock: 100,
        },
      },
    });
  });

  // Reports page
  app.get('/report/conversion_report', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <title>Reports - Shopee Affiliate</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; }
    .form-group { margin-bottom: 15px; }
    label { display: block; margin-bottom: 5px; font-weight: bold; }
    input[type="date"] { padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
    button { padding: 10px 20px; background: #ee4d2d; color: white; border: none; border-radius: 4px; cursor: pointer; margin: 10px 5px 0 0; }
    table { margin-top: 20px; border-collapse: collapse; width: 100%; }
    th, td { padding: 10px; text-align: left; border: 1px solid #ddd; }
    th { background: #f5f5f5; }
  </style>
</head>
<body>
  <h1>รายงานคำสั่งซื้อ</h1>
  <div class="form-group">
    <label for="date-start">เวลาที่สั่งซื้อ</label>
    <input id="date-start" placeholder="วันเริ่มต้น">
  </div>
  <div class="form-group">
    <label for="date-end">เวลาที่สั่งซื้อ</label>
    <input id="date-end" placeholder="วันสิ้นสุด">
  </div>
  <button onclick="downloadReport()">ดาวน์โหลดรายงาน</button>

  <table class="report-table">
    <thead>
      <tr>
        <th>Sub ID</th>
        <th>Clicks</th>
        <th>Orders</th>
        <th>Commission</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>tiktok</td>
        <td>123</td>
        <td>5</td>
        <td>฿150.00</td>
        <td>estimated</td>
      </tr>
    </tbody>
  </table>

  <script>
    function downloadReport() {
      const start = document.getElementById('date-start').value;
      const end = document.getElementById('date-end').value;
      window.location.href = \`/api/v4/affiliate/report/export?start=\${start}&end=\${end}\`;
    }
    fetch('/api/v3/gql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operationName: 'conversionReportUpdateTime' }),
    });
    fetch('/api/v3/goods/categoryList');
    fetch('/api/v3/report/list?page_size=20&page_num=1&purchase_time_s=1760000000&purchase_time_e=1762000000&version=1');
  </script>
</body>
</html>
    `);
  });

  app.get('/api/v3/report/list', (_req, res) => {
    state.reportListCalls += 1;
    res.json({
      code: 0,
      msg: 'success',
      data: {
        page_num: 1,
        page_size: 20,
        total_count: 1,
        list: [{
          purchase_time: 1760000000,
          checkout_status: 'Waiting for payment',
          affiliate_id: 42,
          utm_content: 'tiktok-P1-clip-blue-202610',
          estimated_total_commission: 10,
          orders: [{
            order_sn: 'REDACTED',
            order_status: 'COMPLETED',
            items: [{ item_id: 1, actual_amount: 100, qty: 1, item_commission: 8 }],
          }],
        }],
      },
    });
  });

  app.post('/api/v3/gql', (_req, res) => {
    state.reportListCalls += 1;
    res.json({ data: { conversionReportUpdateTime: '0' } });
  });

  app.get('/api/v3/goods/categoryList', (_req, res) => {
    state.reportListCalls += 1;
    res.json({ code: 0, data: { category_list: [] } });
  });

  // API endpoint for report export
  app.get('/api/v4/affiliate/report/export', (req, res) => {
    state.reportExportCalls += 1;
    const csv = `Sub ID,Clicks,Orders,Commission,Status
tiktok,123,5,150.00,estimated
ig,89,3,95.50,validated
fb,67,2,45.00,paid`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=report.csv');
    res.send(csv);
  });

  return { app, state };
}

export function listenMockAffiliate(port = 0): Promise<{ server: Server; state: MockAffiliateState; baseUrl: string }> {
  const { app, state } = createMockAffiliateServer();
  return new Promise((resolve) => {
    const server = app.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const bound = typeof address === 'object' && address ? address.port : port;
      resolve({ server, state, baseUrl: `http://127.0.0.1:${bound}` });
    });
  });
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) {
  const { app } = createMockAffiliateServer();
  app.listen(3002, '127.0.0.1', () => {
    console.log('Mock Shopee Affiliate server running on http://127.0.0.1:3002');
    console.log('  Custom Link: http://127.0.0.1:3002/offer/custom_link');
    console.log('  Offer Detail: http://127.0.0.1:3002/offer/product_offer/123');
    console.log('  Reports: http://127.0.0.1:3002/report/conversion_report');
  });
}
