let currentTab = 'links';
let batchItems = [];

function switchTab(tab) {
  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.panel');
  
  tabs.forEach(t => t.classList.remove('active'));
  panels.forEach(p => p.classList.remove('active'));
  
  event.target.classList.add('active');
  document.getElementById(`${tab}-panel`).classList.add('active');
  
  currentTab = tab;
  
  if (tab === 'links') searchLinks();
  if (tab === 'queue') loadQueue();
  if (tab === 'status') refreshStatus();
}

async function searchLinks() {
  const product = document.getElementById('search-product').value;
  const channel = document.getElementById('search-channel').value;
  const clip = document.getElementById('search-clip').value;
  
  const params = new URLSearchParams();
  if (product) params.append('product_id', product);
  if (channel) params.append('channel', channel);
  if (clip) params.append('clip_id', clip);
  
  try {
    const res = await fetch(`/api/links?${params}`);
    const data = await res.json();
    
    if (data.ok) {
      renderLinks(data.links);
    }
  } catch (error) {
    console.error('Failed to search links:', error);
  }
}

function renderLinks(links) {
  const container = document.getElementById('links-container');
  
  if (links.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"></path>
        </svg>
        <h3>No links found</h3>
        <p>Try creating your first affiliate link</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = links.map(link => `
    <div class="link-card">
      <h3>
        <span class="badge badge-channel">${link.channel.toUpperCase()}</span>
        ${link.product_id}
      </h3>
      <div class="link-meta">
        <div><strong>Item ID:</strong> ${link.item_id}</div>
        <div><strong>Clip:</strong> ${link.clip_id || 'N/A'}</div>
        <div><strong>Created:</strong> ${new Date(link.created_at).toLocaleDateString('th-TH')}</div>
        <div>
          <strong>Ownership:</strong>
          <span class="badge ${link.ownership_verified === 'true' ? 'badge-verified' : 'badge-unknown'}">
            ${link.ownership_verified}
          </span>
        </div>
        <div>
          <strong>Target:</strong>
          <span class="badge ${link.target_verified === 'true' ? 'badge-verified' : 'badge-unknown'}">
            ${link.target_verified}
          </span>
        </div>
      </div>
      <div style="margin-top: 15px; padding: 10px; background: white; border-radius: 6px; font-family: monospace; font-size: 0.9em; word-break: break-all;">
        ${link.short_link}
      </div>
      <div style="margin-top: 8px; font-size: 0.85em; color: #6b7280;">
        <strong>Sub IDs:</strong> 
        ${[link.sub_ids.sub_id1, link.sub_ids.sub_id2, link.sub_ids.sub_id3, link.sub_ids.sub_id4, link.sub_ids.sub_id5]
          .filter(Boolean).join(', ') || 'None'}
      </div>
    </div>
  `).join('');
}

async function createLink() {
  const productUrl = document.getElementById('product-url').value;
  const channel = document.getElementById('channel').value;
  const clipId = document.getElementById('clip-id').value;
  const subIds = {
    sub_id1: document.getElementById('sub-id-1').value || null,
    sub_id2: document.getElementById('sub-id-2').value || null,
    sub_id3: document.getElementById('sub-id-3').value || null,
    sub_id4: document.getElementById('sub-id-4').value || null,
    sub_id5: document.getElementById('sub-id-5').value || null,
  };
  
  const resultDiv = document.getElementById('create-result');
  
  try {
    const res = await fetch('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_url: productUrl, channel, clip_id: clipId || undefined, sub_ids: subIds }),
    });
    
    const data = await res.json();
    
    if (data.ok) {
      resultDiv.innerHTML = `
        <div class="alert alert-success">
          ${data.created ? 'Link created successfully!' : 'Link already exists (idempotent).'}
        </div>
      `;
      setTimeout(() => { resultDiv.innerHTML = ''; }, 3000);
    } else {
      resultDiv.innerHTML = `<div class="alert alert-error">${data.error}</div>`;
    }
  } catch (error) {
    resultDiv.innerHTML = `<div class="alert alert-error">Failed to create link: ${error.message}</div>`;
  }
}

function addBatchItem() {
  const item = { id: Date.now() };
  batchItems.push(item);
  renderBatchItems();
}

function removeBatchItem(id) {
  batchItems = batchItems.filter(item => item.id !== id);
  renderBatchItems();
}

function renderBatchItems() {
  const container = document.getElementById('batch-items');
  
  if (batchItems.length === 0) {
    container.innerHTML = '<p style="color: #9ca3af;">No items added. Click "Add Item" to start.</p>';
    return;
  }
  
  container.innerHTML = batchItems.map(item => `
    <div class="batch-item">
      <div style="display: flex; gap: 10px; margin-bottom: 10px;">
        <input type="url" placeholder="Product URL" id="batch-url-${item.id}" style="flex: 1;">
        <select id="batch-channel-${item.id}">
          <option value="tiktok">TikTok</option>
          <option value="ig">Instagram</option>
          <option value="fb">Facebook</option>
          <option value="x">X</option>
          <option value="yt">YouTube</option>
          <option value="spv">Shopee Video</option>
        </select>
        <button onclick="removeBatchItem(${item.id})">Remove</button>
      </div>
      <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px;">
        <input type="text" placeholder="Sub ID 1" id="batch-sub1-${item.id}">
        <input type="text" placeholder="Sub ID 2" id="batch-sub2-${item.id}">
        <input type="text" placeholder="Sub ID 3" id="batch-sub3-${item.id}">
        <input type="text" placeholder="Sub ID 4" id="batch-sub4-${item.id}">
        <input type="text" placeholder="Sub ID 5" id="batch-sub5-${item.id}">
      </div>
    </div>
  `).join('');
}

async function createBatch() {
  const items = batchItems.map(item => ({
    product_url: document.getElementById(`batch-url-${item.id}`).value,
    channel: document.getElementById(`batch-channel-${item.id}`).value,
    sub_ids: {
      sub_id1: document.getElementById(`batch-sub1-${item.id}`).value || null,
      sub_id2: document.getElementById(`batch-sub2-${item.id}`).value || null,
      sub_id3: document.getElementById(`batch-sub3-${item.id}`).value || null,
      sub_id4: document.getElementById(`batch-sub4-${item.id}`).value || null,
      sub_id5: document.getElementById(`batch-sub5-${item.id}`).value || null,
    },
  }));
  
  const resultDiv = document.getElementById('batch-result');
  
  try {
    const res = await fetch('/api/links/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    
    const data = await res.json();
    
    if (data.ok) {
      resultDiv.innerHTML = `
        <div class="alert alert-success">
          Batch created! ${data.results.filter(r => r.created).length} new, ${data.results.filter(r => !r.created).length} existing.
        </div>
      `;
      batchItems = [];
      renderBatchItems();
      setTimeout(() => { resultDiv.innerHTML = ''; }, 3000);
    } else {
      resultDiv.innerHTML = `<div class="alert alert-error">${data.error}</div>`;
    }
  } catch (error) {
    resultDiv.innerHTML = `<div class="alert alert-error">Failed to create batch: ${error.message}</div>`;
  }
}

async function getOffer() {
  const itemId = document.getElementById('offer-item-id').value;
  const resultDiv = document.getElementById('offer-result');
  
  try {
    const res = await fetch(`/api/offers/${itemId}`);
    const data = await res.json();
    
    if (data.ok) {
      resultDiv.innerHTML = `
        <div class="link-card">
          <h3>Offer for Item ${data.offer.item_id}</h3>
          <div class="link-meta">
            <div><strong>Price:</strong> ฿${data.offer.price.toFixed(2)}</div>
            <div><strong>Store commission:</strong> ${data.offer.commission_rate_social}%</div>
            <div><strong>Commission on this price:</strong> ฿${(data.offer.price * data.offer.commission_rate_social / 100).toFixed(2)}</div>
            <div><strong>Video Rate:</strong> ${data.offer.commission_rate_video ? data.offer.commission_rate_video + '%' : 'N/A'}</div>
            <div><strong>Extra Comm:</strong> ${data.offer.extra_comm ? 'Yes' : 'No'}</div>
            <div><strong>In Stock:</strong> ${data.offer.stock_available ? 'Yes' : 'No'}</div>
            <div><strong>As of:</strong> ${new Date(data.offer.as_of).toLocaleString('th-TH')}</div>
          </div>
        </div>
      `;
    } else {
      resultDiv.innerHTML = `<div class="alert alert-error">${data.error}</div>`;
    }
  } catch (error) {
    resultDiv.innerHTML = `<div class="alert alert-error">Failed to get offer: ${error.message}</div>`;
  }
}

async function loadQueue() {
  const container = document.getElementById('queue-container');
  
  try {
    const res = await fetch('/api/queue');
    const data = await res.json();
    
    if (data.ok) {
      if (data.jobs.length === 0) {
        container.innerHTML = '<div class="empty-state"><h3>Queue is empty</h3></div>';
        return;
      }
      
      container.innerHTML = data.jobs.map(job => `
        <div class="queue-item">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <strong>${job.type}</strong>
            <span class="queue-status ${job.status}">${job.status.toUpperCase()}</span>
          </div>
          <div style="font-size: 0.9em; color: #6b7280;">
            <strong>Job ID:</strong> ${job.job_id}<br>
            <strong>Created:</strong> ${new Date(job.created_at).toLocaleString('th-TH')}
          </div>
        </div>
      `).join('');
    }
  } catch (error) {
    container.innerHTML = `<div class="alert alert-error">Failed to load queue: ${error.message}</div>`;
  }
}

async function refreshStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    
    const statusBadge = document.getElementById('chrome-status');
    if (data.ok) {
      if (data.chrome_connected) {
        statusBadge.className = 'status-badge connected';
        statusBadge.textContent = 'Chrome: Connected';
      } else {
        statusBadge.className = 'status-badge disconnected';
        statusBadge.textContent = 'Chrome: Disconnected';
      }
      
      if (currentTab === 'status') {
        const statusDetail = document.getElementById('status-detail');
        statusDetail.innerHTML = `
          <div class="link-card">
            <h3>Connection Status</h3>
            <div class="link-meta">
              <div><strong>Chrome:</strong> ${data.chrome_connected ? '✅ Connected' : '❌ Disconnected'}</div>
              <div><strong>CDP URL:</strong> ${data.cdp_url}</div>
              <div><strong>Queued Jobs:</strong> ${data.queued_jobs.length}</div>
              <div><strong>As of:</strong> ${new Date(data.as_of).toLocaleString('th-TH')}</div>
            </div>
          </div>
        `;
      }
    }
  } catch (error) {
    console.error('Failed to refresh status:', error);
  }
}

setInterval(refreshStatus, 5000);
refreshStatus();
searchLinks();
