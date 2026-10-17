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
  app.get('/linkmanage/customlink', (req, res) => {
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
      <label for="product-url">Product URL *</label>
      <input type="text" id="product-url" name="productUrl" placeholder="https://shopee.co.th/product-i.shop.item" required>
    </div>
    <div class="form-group">
      <label for="sub-id-1">Sub ID 1</label>
      <input type="text" id="sub-id-1" name="subId1" placeholder="Sub ID 1">
    </div>
    <div class="form-group">
      <label for="sub-id-2">Sub ID 2</label>
      <input type="text" id="sub-id-2" name="subId2" placeholder="Sub ID 2">
    </div>
    <div class="form-group">
      <label for="sub-id-3">Sub ID 3</label>
      <input type="text" id="sub-id-3" name="subId3" placeholder="Sub ID 3">
    </div>
    <div class="form-group">
      <label for="sub-id-4">Sub ID 4</label>
      <input type="text" id="sub-id-4" name="subId4" placeholder="Sub ID 4">
    </div>
    <div class="form-group">
      <label for="sub-id-5">Sub ID 5</label>
      <input type="text" id="sub-id-5" name="subId5" placeholder="Sub ID 5">
    </div>
    <div class="error-message"></div>
    <button type="submit">สร้างลิงก์ (Create Link)</button>
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
      const formData = new FormData(e.target);
      const data = Object.fromEntries(formData);
      
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

      <button id="get-link">รับลิงก์ (Get Link)</button>
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

    fetch('/api/v4/affiliate/offer/detail/${itemId}', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
  </script>
</body>
</html>
    `);
  });

  // API endpoint for offer detail
  app.get('/api/v4/affiliate/offer/detail/:itemId', (req, res) => {
    state.offerDetailCalls += 1;
    const { itemId } = req.params;
    
    res.json({
      ok: true,
      data: {
        item_id: itemId,
        product_name: `Mock Product ${itemId}`,
        commission_rate: 10,
        commission_pct: 10,
        price: '299.00-599.00',
        shop_id: '12345',
        stock: 100,
      },
    });
  });

  // Reports page
  app.get('/report', (req, res) => {
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
  <h1>รายงาน (Reports)</h1>
  <div class="form-group">
    <label for="date-start">Start Date</label>
    <input type="date" id="date-start" name="start">
  </div>
  <div class="form-group">
    <label for="date-end">End Date</label>
    <input type="date" id="date-end" name="end">
  </div>
  <button onclick="downloadReport()">ดาวน์โหลด (Download)</button>

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
    fetch('/api/v4/affiliate/report/summary');
  </script>
</body>
</html>
    `);
  });

  app.get('/api/v4/affiliate/report/summary', (_req, res) => {
    state.reportListCalls += 1;
    res.json({ ok: true, data: { rows: 1 } });
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
    console.log('  Custom Link: http://127.0.0.1:3002/linkmanage/customlink');
    console.log('  Offer Detail: http://127.0.0.1:3002/offer/product_offer/123');
    console.log('  Reports: http://127.0.0.1:3002/report');
  });
}
