import express from 'express';
import crypto from 'crypto';

const app = express();
app.use(express.json());

let showCaptcha = false;

function signRequest(data: any): string {
  const payload = JSON.stringify(data);
  const signature = crypto.createHmac('sha256', 'mock-secret').update(payload).digest('hex');
  return signature;
}

function verifySignature(data: any, sig: string): boolean {
  const expected = signRequest(data);
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

app.get('/', (req, res) => {
  if (showCaptcha) {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Shopee - Security Check</title></head>
      <body>
        <div class="captcha-container">
          <h1>Security Verification</h1>
          <p>Please verify you are human</p>
          <div id="captcha-challenge">Click the checkbox to continue</div>
          <button onclick="location.href='/?verified=true'">Verify</button>
        </div>
      </body>
      </html>
    `);
    return;
  }

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Mock Shopee - Affiliate</title>
      <script>
        function mintSignature(data) {
          return 'mock-signature-' + Date.now();
        }

        async function fetchProductOffer(itemId) {
          const signature = mintSignature({ item_id: itemId });
          const response = await fetch('/api/v4/affiliate/product_offer', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'af-ac-enc-dat': signature,
              'x-sap-sec': signature,
            },
            body: JSON.stringify({ item_id: itemId }),
          });
          return response.json();
        }

        window.addEventListener('DOMContentLoaded', () => {
          const itemId = new URLSearchParams(location.search).get('item_id');
          if (itemId) {
            fetchProductOffer(itemId).then(data => {
              document.getElementById('product-data').textContent = JSON.stringify(data, null, 2);
            });
          }
        });
      </script>
    </head>
    <body>
      <h1>Mock Shopee Affiliate</h1>
      <p>This is a mock Shopee site for testing. It signs API calls like the real Shopee does.</p>
      <pre id="product-data">No data loaded</pre>
    </body>
    </html>
  `);
});

app.post('/api/v4/affiliate/product_offer', (req, res) => {
  const signature = req.headers['af-ac-enc-dat'] || req.headers['x-sap-sec'];
  
  if (!signature || typeof signature !== 'string') {
    return res.status(400).json({ error: 90309999, message: 'Missing or invalid signature' });
  }

  const { item_id } = req.body;
  
  if (!item_id) {
    return res.status(400).json({ error: 'invalid_request', message: 'Missing item_id' });
  }

  res.json({
    error: null,
    data: {
      item_id,
      title: `Mock Product ${item_id}`,
      price: 299.50,
      commission: {
        social: 7.5,
        video: 9.0,
      },
      extra_comm: true,
      stock: 100,
      shop: {
        shop_id: '123456',
        official: true,
      },
    },
    signature: signRequest({ item_id, timestamp: Date.now() }),
  });
});

app.post('/api/v4/affiliate/create_link', (req, res) => {
  const signature = req.headers['af-ac-enc-dat'] || req.headers['x-sap-sec'];
  
  if (!signature || typeof signature !== 'string') {
    return res.status(400).json({ error: 90309999, message: 'Missing or invalid signature' });
  }

  const { item_id, sub_ids } = req.body;
  
  if (!item_id) {
    return res.status(400).json({ error: 'invalid_request', message: 'Missing item_id' });
  }

  const shortCode = crypto.randomBytes(6).toString('base64url');
  
  res.json({
    error: null,
    data: {
      short_link: `https://s.shopee.co.th/${shortCode}`,
      long_link: `https://shopee.co.th/product-i.123456.${item_id}?subid=${(sub_ids || []).join(',')}`,
      item_id,
      sub_ids: sub_ids || [],
      created_at: new Date().toISOString(),
    },
  });
});

app.get('/captcha/enable', (req, res) => {
  showCaptcha = true;
  res.json({ ok: true, message: 'CAPTCHA enabled. Next requests will show verification page.' });
});

app.get('/captcha/disable', (req, res) => {
  showCaptcha = false;
  res.json({ ok: true, message: 'CAPTCHA disabled.' });
});

app.get('/captcha/status', (req, res) => {
  res.json({ captcha_enabled: showCaptcha });
});

app.post('/api/v4/test/direct_fetch', (req, res) => {
  res.status(403).json({ 
    error: 90309999, 
    message: 'Direct fetch not allowed. Request must be made from page JS with proper signatures.' 
  });
});

const port = parseInt(process.env.MOCK_SHOPEE_PORT || '3001', 10);

app.listen(port, () => {
  console.log(`Mock Shopee site running at http://localhost:${port}`);
  console.log('Test CAPTCHA: GET /captcha/enable, /captcha/disable, /captcha/status');
});
