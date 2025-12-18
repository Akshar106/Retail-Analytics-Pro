// ===== CONFIGURATION =====
const API_BASE = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") 
  ? "http://localhost:5000/api" 
  : `${window.location.origin}/api`;

// ===== STATE MANAGEMENT =====
let currentFilters = {};
let currentProducts = [];
let currentTransactions = [];
let currentPage = 1;
let pageSize = 50;
let editingTransactionId = null;

// ===== UTILITY FUNCTIONS =====
function buildQuery(params) {
  const query = Object.keys(params)
    .filter(k => params[k] !== undefined && params[k] !== null && params[k] !== "")
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join("&");
  return query ? `?${query}` : "";
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2
  }).format(value || 0);
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value || 0);
}

function formatDate(dateString) {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function showLoading() {
  document.getElementById('loadingOverlay').classList.add('active');
}

function hideLoading() {
  document.getElementById('loadingOverlay').classList.remove('active');
}

function showAlert(message, type = 'info') {
  const container = document.getElementById('alertContainer');
  const alert = document.createElement('div');
  alert.className = `alert alert-${type}`;
  alert.innerHTML = `
    <span style="font-size: 20px;">${type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ'}</span>
    <span>${message}</span>
  `;
  container.appendChild(alert);
  
  setTimeout(() => {
    alert.style.opacity = '0';
    alert.style.transform = 'translateY(-20px)';
    setTimeout(() => alert.remove(), 300);
  }, 4000);
}

// ===== DATE PRESET FUNCTIONS =====
function setDatePreset(preset) {
  const now = new Date();
  const startInput = document.getElementById('startDate');
  const endInput = document.getElementById('endDate');
  
  // Remove active class from all preset buttons
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // Add active class to clicked button
  event.target.classList.add('active');
  
  let startDate, endDate;
  
  switch(preset) {
    case 'today':
      startDate = endDate = new Date();
      break;
    case 'yesterday':
      startDate = endDate = new Date(now.setDate(now.getDate() - 1));
      break;
    case 'week':
      endDate = new Date();
      startDate = new Date(now.setDate(now.getDate() - 7));
      break;
    case 'month':
      endDate = new Date();
      startDate = new Date(now.setMonth(now.getMonth() - 1));
      break;
    case 'quarter':
      endDate = new Date();
      startDate = new Date(now.setMonth(now.getMonth() - 3));
      break;
    case 'year':
      endDate = new Date();
      startDate = new Date(now.setFullYear(now.getFullYear() - 1));
      break;
    case 'all':
      startInput.value = '';
      endInput.value = '';
      return;
  }
  
  startInput.value = startDate.toISOString().split('T')[0];
  endInput.value = endDate.toISOString().split('T')[0];
}

function getFilters() {
  const start = document.getElementById('startDate').value;
  const end = document.getElementById('endDate').value;
  const countrySelect = document.getElementById('countrySelect');
  const selectedCountries = Array.from(countrySelect.selectedOptions).map(o => o.value).filter(v => v);
  
  return {
    start_date: start || null,
    end_date: end || null,
    countries: selectedCountries.length ? selectedCountries.join(',') : null
  };
}

function applyFilters() {
  currentFilters = getFilters();
  refreshAll();
}

function clearFilters() {
  document.getElementById('startDate').value = '';
  document.getElementById('endDate').value = '';
  document.getElementById('countrySelect').selectedIndex = -1;
  document.getElementById('segmentFilter').value = '';
  document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
  currentFilters = {};
  refreshAll();
}

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  setupTabs();
  await populateCountries();
  await refreshAll();
});

function setupEventListeners() {
  // Filter controls
  document.getElementById('applyFiltersBtn').addEventListener('click', applyFilters);
  document.getElementById('clearFiltersBtn').addEventListener('click', clearFilters);
  document.getElementById('refreshBtn').addEventListener('click', refreshAll);
  
  // Export buttons
  document.getElementById('exportCsvBtn').addEventListener('click', () => exportData('csv'));
  document.getElementById('exportPdfBtn').addEventListener('click', () => exportData('pdf'));
  
  // Product search
  document.getElementById('productSearch').addEventListener('input', (e) => {
    filterProducts(e.target.value);
  });
  
  // Product sort
  document.getElementById('sortProducts').addEventListener('change', (e) => {
    sortProducts(e.target.value);
  });
  
  // RFM compute
  document.getElementById('computeRfmBtn').addEventListener('click', async () => {
    const k = document.getElementById('rfmClusters').value;
    await fetchRFM(parseInt(k));
  });
  
  // Transaction modal
  document.getElementById('addTransactionBtn').addEventListener('click', openTransactionModal);
  document.querySelector('.close-btn').addEventListener('click', closeTransactionModal);
  document.getElementById('cancelFormBtn').addEventListener('click', closeTransactionModal);
  document.getElementById('transactionForm').addEventListener('submit', handleTransactionSubmit);
  
  // Preset date buttons
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      setDatePreset(btn.dataset.preset);
    });
  });
  
  // Toggle filters
  document.getElementById('toggleFilters').addEventListener('click', () => {
    const content = document.getElementById('filtersContent');
    const btn = document.getElementById('toggleFilters');
    content.classList.toggle('collapsed');
    btn.textContent = content.classList.contains('collapsed') ? '▶' : '▼';
  });
}

function setupTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  const contents = document.querySelectorAll('.tab-content');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      const target = tab.dataset.tab;
      contents.forEach(c => c.classList.remove('active'));
      document.getElementById(target).classList.add('active');
      
      // Load tab-specific data
      if (target === 'analytics') {
        loadAdvancedAnalytics();
      }
    });
  });
}

// ===== DATA FETCHING =====
async function refreshAll() {
  showLoading();
  try {
    await Promise.all([
      fetchSummary(),
      populateCountries(),
      fetchRevenueByCountry(),
      fetchTopProducts(),
      fetchMonthlyTrend(),
      fetchDailyPattern(),
      fetchCategoryDistribution(),
      fetchProductsTable(),
      fetchTransactionsList()
    ]);
    showAlert('Data refreshed successfully!', 'success');
  } catch (error) {
    showAlert('Error refreshing data: ' + error.message, 'error');
  } finally {
    hideLoading();
  }
}

async function populateCountries() {
  try {
    const res = await fetch(`${API_BASE}/countries`);
    const countries = await res.json();
    const select = document.getElementById('countrySelect');
    select.innerHTML = '<option value="">All Countries</option>';
    countries.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      select.appendChild(opt);
    });
  } catch (error) {
    console.error('Could not load countries', error);
  }
}

async function fetchSummary() {
  try {
    const res = await fetch(`${API_BASE}/summary${buildQuery(currentFilters)}`);
    const data = await res.json();
    
    document.getElementById('totalRevenue').textContent = formatCurrency(data.total_revenue);
    document.getElementById('totalOrders').textContent = formatNumber(data.total_orders);
    document.getElementById('uniqueCustomers').textContent = formatNumber(data.unique_customers);
    document.getElementById('avgOrderValue').textContent = formatCurrency(data.avg_order_value);
    
    // Add trend indicators (simulated - you can calculate real trends)
    updateTrend('revenueTrend', 12.5);
    updateTrend('ordersTrend', 8.3);
    updateTrend('customersTrend', -2.1);
    updateTrend('avgOrderTrend', 5.7);
  } catch (error) {
    console.error('Error fetching summary:', error);
  }
}

function updateTrend(elementId, value) {
  const el = document.getElementById(elementId);
  const isPositive = value > 0;
  el.className = `kpi-trend ${isPositive ? 'positive' : 'negative'}`;
  el.textContent = `${isPositive ? '↑' : '↓'} ${Math.abs(value).toFixed(1)}%`;
}

// ===== CHART FUNCTIONS =====
async function fetchRevenueByCountry() {
  try {
    const res = await fetch(`${API_BASE}/revenue_by_country${buildQuery(currentFilters)}`);
    const data = await res.json();
    
    // Limit to top 15 countries
    const topData = data.slice(0, 15);
    
    const trace = {
      x: topData.map(d => d.Country),
      y: topData.map(d => d.Revenue),
      type: 'bar',
      marker: {
        color: topData.map((_, i) => `hsl(${240 + i * 10}, 80%, 60%)`),
        line: { width: 0 }
      },
      text: topData.map(d => formatCurrency(d.Revenue)),
      textposition: 'outside',
      hovertemplate: '<b>%{x}</b><br>Revenue: %{text}<extra></extra>'
    };
    
    const layout = {
      margin: { t: 20, r: 20, b: 80, l: 80 },
      xaxis: { 
        tickangle: -45,
        automargin: true
      },
      yaxis: { 
        title: 'Revenue ($)',
        tickformat: '$,.0f'
      },
      plot_bgcolor: 'rgba(0,0,0,0)',
      paper_bgcolor: 'rgba(0,0,0,0)',
      font: { family: 'inherit' }
    };
    
    const config = { responsive: true, displayModeBar: false };
    Plotly.newPlot('revByCountry', [trace], layout, config);
  } catch (error) {
    console.error('Error fetching revenue by country:', error);
  }
}

async function fetchTopProducts() {
  try {
    const res = await fetch(`${API_BASE}/top_products${buildQuery({...currentFilters, limit: 10})}`);
    const data = await res.json();
    
    const trace = {
      y: data.map(d => (d.Description || d.StockCode).substring(0, 30)),
      x: data.map(d => d.Revenue),
      type: 'bar',
      orientation: 'h',
      marker: {
        color: 'rgba(99, 102, 241, 0.7)',
        line: { width: 0 }
      },
      text: data.map(d => formatCurrency(d.Revenue)),
      textposition: 'outside',
      hovertemplate: '<b>%{y}</b><br>Revenue: %{text}<extra></extra>'
    };
    
    const layout = {
      margin: { t: 20, r: 100, b: 40, l: 200 },
      xaxis: { 
        title: 'Revenue ($)',
        tickformat: '$,.0f'
      },
      yaxis: { 
        automargin: true
      },
      plot_bgcolor: 'rgba(0,0,0,0)',
      paper_bgcolor: 'rgba(0,0,0,0)',
      font: { family: 'inherit' }
    };
    
    const config = { responsive: true, displayModeBar: false };
    Plotly.newPlot('topProducts', [trace], layout, config);
  } catch (error) {
    console.error('Error fetching top products:', error);
  }
}

async function fetchMonthlyTrend() {
  try {
    const res = await fetch(`${API_BASE}/monthly_trend${buildQuery(currentFilters)}`);
    const data = await res.json();
    
    const trace = {
      x: data.map(d => d.year_month),
      y: data.map(d => d.Revenue),
      type: 'scatter',
      mode: 'lines+markers',
      line: {
        color: 'rgba(99, 102, 241, 1)',
        width: 3,
        shape: 'spline'
      },
      marker: {
        size: 8,
        color: 'rgba(139, 92, 246, 1)',
        line: { color: 'white', width: 2 }
      },
      fill: 'tozeroy',
      fillcolor: 'rgba(99, 102, 241, 0.1)',
      hovertemplate: '<b>%{x}</b><br>Revenue: $%{y:,.2f}<extra></extra>'
    };
    
    const layout = {
      margin: { t: 20, r: 40, b: 60, l: 80 },
      xaxis: { 
        title: 'Month',
        tickangle: -45
      },
      yaxis: { 
        title: 'Revenue ($)',
        tickformat: '$,.0f'
      },
      plot_bgcolor: 'rgba(0,0,0,0)',
      paper_bgcolor: 'rgba(0,0,0,0)',
      font: { family: 'inherit' }
    };
    
    const config = { responsive: true, displayModeBar: false };
    Plotly.newPlot('monthlyTrend', [trace], layout, config);
  } catch (error) {
    console.error('Error fetching monthly trend:', error);
  }
}

async function fetchDailyPattern() {
  try {
    const res = await fetch(`${API_BASE}/transactions${buildQuery(currentFilters)}`);
    const transactions = await res.json();
    
    // Group by day of week
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayRevenue = Array(7).fill(0);
    
    transactions.forEach(t => {
      if (t.InvoiceDate) {
        const day = new Date(t.InvoiceDate).getDay();
        dayRevenue[day] += (t.Quantity || 0) * (t.Price || 0);
      }
    });
    
    const trace = {
      x: dayNames,
      y: dayRevenue,
      type: 'bar',
      marker: {
        color: dayRevenue.map((_, i) => `hsl(${i * 50}, 70%, 60%)`),
      },
      text: dayRevenue.map(r => formatCurrency(r)),
      textposition: 'outside'
    };
    
    const layout = {
      margin: { t: 20, r: 20, b: 60, l: 80 },
      xaxis: { title: 'Day of Week' },
      yaxis: { title: 'Revenue ($)', tickformat: '$,.0f' },
      plot_bgcolor: 'rgba(0,0,0,0)',
      paper_bgcolor: 'rgba(0,0,0,0)',
      font: { family: 'inherit' }
    };
    
    Plotly.newPlot('dailyPattern', [trace], layout, { responsive: true, displayModeBar: false });
  } catch (error) {
    console.error('Error fetching daily pattern:', error);
  }
}

async function fetchCategoryDistribution() {
  try {
    const res = await fetch(`${API_BASE}/transactions${buildQuery(currentFilters)}`);
    const transactions = await res.json();
    
    // Simple category grouping by first word of description
    const categories = {};
    transactions.forEach(t => {
      if (t.Description) {
        const category = t.Description.split(' ')[0] || 'Other';
        categories[category] = (categories[category] || 0) + ((t.Quantity || 0) * (t.Price || 0));
      }
    });
    
    // Get top 10 categories
    const sorted = Object.entries(categories)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    const trace = {
      labels: sorted.map(([cat]) => cat),
      values: sorted.map(([, val]) => val),
      type: 'pie',
      hole: 0.4,
      marker: {
        colors: sorted.map((_, i) => `hsl(${i * 36}, 70%, 60%)`)
      },
      textinfo: 'label+percent',
      hovertemplate: '<b>%{label}</b><br>Revenue: $%{value:,.2f}<br>%{percent}<extra></extra>'
    };
    
    const layout = {
      margin: { t: 20, r: 20, b: 20, l: 20 },
      showlegend: false,
      plot_bgcolor: 'rgba(0,0,0,0)',
      paper_bgcolor: 'rgba(0,0,0,0)',
      font: { family: 'inherit' }
    };
    
    Plotly.newPlot('categoryDist', [trace], layout, { responsive: true, displayModeBar: false });
  } catch (error) {
    console.error('Error fetching category distribution:', error);
  }
}

// ===== PRODUCT TABLE =====
async function fetchProductsTable() {
  try {
    const res = await fetch(`${API_BASE}/top_products${buildQuery({...currentFilters, limit: 200})}`);
    currentProducts = await res.json();
    renderProductsTable(currentProducts);
  } catch (error) {
    console.error('Error fetching products:', error);
  }
}

function renderProductsTable(products) {
  const tbody = document.querySelector('#productTable tbody');
  tbody.innerHTML = '';
  
  if (products.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px;">No products found</td></tr>';
    return;
  }
  
  products.forEach((p, index) => {
    const tr = document.createElement('tr');
    const avgPrice = p.Quantity ? (p.Revenue / p.Quantity) : 0;
    const performance = p.Revenue > 1000 ? '🔥' : p.Revenue > 500 ? '⭐' : '✓';
    
    tr.innerHTML = `
      <td><strong>#${index + 1}</strong></td>
      <td><code>${p.StockCode || 'N/A'}</code></td>
      <td>${(p.Description || 'N/A').substring(0, 50)}</td>
      <td>${formatNumber(p.Quantity || 0)}</td>
      <td><strong>${formatCurrency(p.Revenue)}</strong></td>
      <td>${formatCurrency(avgPrice)}</td>
      <td style="font-size: 20px; text-align: center;">${performance}</td>
    `;
    tbody.appendChild(tr);
  });
}

function filterProducts(query) {
  const q = query.toLowerCase().trim();
  if (!q) {
    renderProductsTable(currentProducts);
    return;
  }
  
  const filtered = currentProducts.filter(p => {
    const desc = (p.Description || '').toLowerCase();
    const code = (p.StockCode || '').toLowerCase();
    return desc.includes(q) || code.includes(q);
  });
  
  renderProductsTable(filtered);
}

function sortProducts(sortBy) {
  let sorted = [...currentProducts];
  
  switch(sortBy) {
    case 'revenue':
      sorted.sort((a, b) => (b.Revenue || 0) - (a.Revenue || 0));
      break;
    case 'quantity':
      sorted.sort((a, b) => (b.Quantity || 0) - (a.Quantity || 0));
      break;
    case 'code':
      sorted.sort((a, b) => (a.StockCode || '').localeCompare(b.StockCode || ''));
      break;
  }
  
  renderProductsTable(sorted);
}

// ===== RFM ANALYSIS =====
async function fetchRFM(k = 4) {
  try {
    showLoading();
    const res = await fetch(`${API_BASE}/rfm${buildQuery({ k })}`);
    const data = await res.json();
    
    if (res.ok) {
      renderRFMCharts(data);
      renderRFMTable(data);
      showAlert(`RFM analysis completed with ${k} clusters!`, 'success');
    } else {
      showAlert('RFM error: ' + JSON.stringify(data), 'error');
    }
  } catch (error) {
    showAlert('Network error: ' + error.message, 'error');
  } finally {
    hideLoading();
  }
}

function renderRFMCharts(data) {
  const container = document.getElementById('rfmCharts');
  container.innerHTML = '';
  
  // Create scatter plot
  const chartDiv = document.createElement('div');
  chartDiv.className = 'chart-container full-width';
  chartDiv.innerHTML = '<div class="chart-header"><h3 class="chart-title">RFM Customer Segments</h3></div><div id="rfmScatter" class="chart"></div>';
  container.appendChild(chartDiv);
  
  // Group by cluster
  const clusters = {};
  data.forEach(d => {
    if (!clusters[d.cluster]) clusters[d.cluster] = [];
    clusters[d.cluster].push(d);
  });
  
  const traces = Object.entries(clusters).map(([cluster, customers]) => ({
    x: customers.map(c => c.Frequency),
    y: customers.map(c => c.Monetary),
    mode: 'markers',
    type: 'scatter',
    name: `Cluster ${cluster}`,
    marker: {
      size: customers.map(c => Math.max(5, 30 - c.Recency / 10)),
      color: `hsl(${cluster * 80}, 70%, 60%)`,
      line: { color: 'white', width: 1 }
    },
    text: customers.map(c => `Customer: ${c.CustomerID}<br>Recency: ${c.Recency} days<br>Frequency: ${c.Frequency}<br>Monetary: $${c.Monetary.toFixed(2)}`),
    hovertemplate: '%{text}<extra></extra>'
  }));
  
  const layout = {
    margin: { t: 20, r: 40, b: 60, l: 80 },
    xaxis: { title: 'Frequency (# of Orders)' },
    yaxis: { title: 'Monetary Value ($)' },
    plot_bgcolor: 'rgba(0,0,0,0)',
    paper_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'inherit' },
    showlegend: true
  };
  
  Plotly.newPlot('rfmScatter', traces, layout, { responsive: true, displayModeBar: false });
}

function renderRFMTable(data) {
  const container = document.getElementById('rfmTableContainer');
  
  if (!data || data.length === 0) {
    container.innerHTML = '<p style="text-align: center; padding: 40px; color: var(--gray-500);">No RFM data available</p>';
    return;
  }
  
  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Customer ID</th>
        <th>Recency (days)</th>
        <th>Frequency</th>
        <th>Monetary</th>
        <th>Cluster</th>
        <th>Segment</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  
  const tbody = table.querySelector('tbody');
  data.slice(0, 100).forEach(d => {
    const segment = getSegmentName(d);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${d.CustomerID}</strong></td>
      <td>${d.Recency || 'N/A'}</td>
      <td>${d.Frequency}</td>
      <td>${formatCurrency(d.Monetary)}</td>
      <td><span style="display: inline-block; width: 24px; height: 24px; border-radius: 50%; background: hsl(${d.cluster * 80}, 70%, 60%);"></span></td>
      <td><strong>${segment}</strong></td>
    `;
    tbody.appendChild(tr);
  });
  
  container.innerHTML = '';
  container.appendChild(table);
}

function getSegmentName(customer) {
  const { Recency, Frequency, Monetary } = customer;
  
  if (Frequency >= 10 && Monetary >= 1000) return '💎 VIP';
  if (Recency <= 30 && Frequency >= 5) return '⭐ Loyal';
  if (Recency <= 60 && Monetary >= 500) return '🔥 Active';
  if (Recency <= 90) return '✓ Regular';
  if (Recency > 180) return '💤 At Risk';
  return '👤 Standard';
}

// ===== TRANSACTIONS CRUD =====
async function fetchTransactionsList() {
  try {
    const res = await fetch(`${API_BASE}/transactions${buildQuery(currentFilters)}`);
    currentTransactions = await res.json();
    renderTransactionsTable(currentTransactions);
  } catch (error) {
    console.error('Error fetching transactions:', error);
  }
}

function renderTransactionsTable(transactions) {
  const tbody = document.querySelector('#transactionTable tbody');
  tbody.innerHTML = '';
  
  if (transactions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; padding: 40px;">No transactions found</td></tr>';
    return;
  }
  
  const start = (currentPage - 1) * pageSize;
  const end = start + pageSize;
  const pageData = transactions.slice(start, end);
  
  pageData.forEach(t => {
    const revenue = (t.Quantity || 0) * (t.Price || 0);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><code style="font-size: 11px;">${(t._id || '').substring(0, 8)}...</code></td>
      <td>${t.Invoice || 'N/A'}</td>
      <td>${formatDate(t.InvoiceDate)}</td>
      <td><code>${t.StockCode || 'N/A'}</code></td>
      <td>${(t.Description || 'N/A').substring(0, 30)}</td>
      <td>${t.Quantity || 0}</td>
      <td>${formatCurrency(t.Price)}</td>
      <td>${t.CustomerID || 'N/A'}</td>
      <td>${t.Country || 'N/A'}</td>
      <td><strong>${formatCurrency(revenue)}</strong></td>
      <td>
        <button class="btn-icon" onclick="editTransaction('${t._id}')" title="Edit">✏️</button>
        <button class="btn-icon" onclick="deleteTransaction('${t._id}')" title="Delete">🗑️</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  
  renderPagination(transactions.length);
}

function renderPagination(total) {
  const container = document.getElementById('pagination');
  const totalPages = Math.ceil(total / pageSize);
  
  container.innerHTML = `
    <button onclick="changePage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>« Previous</button>
    <span style="padding: 0 20px; font-weight: 600;">Page ${currentPage} of ${totalPages}</span>
    <button onclick="changePage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>Next »</button>
  `;
}

function changePage(page) {
  const totalPages = Math.ceil(currentTransactions.length / pageSize);
  if (page < 1 || page > totalPages) return;
  currentPage = page;
  renderTransactionsTable(currentTransactions);
}

function openTransactionModal(id = null) {
  editingTransactionId = id;
  const modal = document.getElementById('transactionModal');
  const title = document.getElementById('modalTitle');
  const form = document.getElementById('transactionForm');
  
  if (id) {
    title.textContent = 'Edit Transaction';
    const transaction = currentTransactions.find(t => t._id === id);
    if (transaction) {
      document.getElementById('formInvoice').value = transaction.Invoice || '';
      document.getElementById('formStockCode').value = transaction.StockCode || '';
      document.getElementById('formDescription').value = transaction.Description || '';
      document.getElementById('formQuantity').value = transaction.Quantity || 1;
      document.getElementById('formPrice').value = transaction.Price || 0;
      document.getElementById('formCustomerID').value = transaction.CustomerID || '';
      document.getElementById('formCountry').value = transaction.Country || '';
      if (transaction.InvoiceDate) {
        const date = new Date(transaction.InvoiceDate);
        document.getElementById('formInvoiceDate').value = date.toISOString().slice(0, 16);
      }
    }
  } else {
    title.textContent = 'Add New Transaction';
    form.reset();
  }
  
  modal.classList.add('active');
}

function closeTransactionModal() {
  document.getElementById('transactionModal').classList.remove('active');
  editingTransactionId = null;
}

async function handleTransactionSubmit(e) {
  e.preventDefault();
  
  const payload = {
    Invoice: document.getElementById('formInvoice').value,
    StockCode: document.getElementById('formStockCode').value,
    Description: document.getElementById('formDescription').value,
    Quantity: parseInt(document.getElementById('formQuantity').value),
    Price: parseFloat(document.getElementById('formPrice').value),
    CustomerID: document.getElementById('formCustomerID').value,
    Country: document.getElementById('formCountry').value,
    InvoiceDate: document.getElementById('formInvoiceDate').value || new Date().toISOString()
  };
  
  try {
    showLoading();
    let res;
    
    if (editingTransactionId) {
      res = await fetch(`${API_BASE}/transactions/${editingTransactionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch(`${API_BASE}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }
    
    const data = await res.json();
    
    if (res.ok) {
      showAlert(editingTransactionId ? 'Transaction updated successfully!' : 'Transaction created successfully!', 'success');
      closeTransactionModal();
      await refreshAll();
    } else {
      showAlert('Error: ' + (data.error || JSON.stringify(data)), 'error');
    }
  } catch (error) {
    showAlert('Network error: ' + error.message, 'error');
  } finally {
    hideLoading();
  }
}

async function editTransaction(id) {
  openTransactionModal(id);
}

async function deleteTransaction(id) {
  if (!confirm('Are you sure you want to delete this transaction?')) return;
  
  try {
    showLoading();
    const res = await fetch(`${API_BASE}/transactions/${id}`, { method: 'DELETE' });
    const data = await res.json();
    
    if (res.ok) {
      showAlert(`Deleted ${data.deleted} transaction(s)`, 'success');
      await refreshAll();
    } else {
      showAlert('Delete error: ' + (data.error || JSON.stringify(data)), 'error');
    }
  } catch (error) {
    showAlert('Network error: ' + error.message, 'error');
  } finally {
    hideLoading();
  }
}

// ===== ADVANCED ANALYTICS =====
async function loadAdvancedAnalytics() {
  await Promise.all([
    renderCLVChart(),
    renderFrequencyChart(),
    renderCohortChart(),
    renderForecastChart(),
    renderAssociationChart()
  ]);
}

async function renderCLVChart() {
  try {
    const res = await fetch(`${API_BASE}/rfm${buildQuery({ k: 4 })}`);
    const data = await res.json();
    
    const clvBuckets = { '0-100': 0, '100-500': 0, '500-1000': 0, '1000-5000': 0, '5000+': 0 };
    
    data.forEach(d => {
      const clv = d.Monetary;
      if (clv < 100) clvBuckets['0-100']++;
      else if (clv < 500) clvBuckets['100-500']++;
      else if (clv < 1000) clvBuckets['500-1000']++;
      else if (clv < 5000) clvBuckets['1000-5000']++;
      else clvBuckets['5000+']++;
    });
    
    const trace = {
      x: Object.keys(clvBuckets),
      y: Object.values(clvBuckets),
      type: 'bar',
      marker: {
        color: ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981']
      }
    };
    
    const layout = {
      margin: { t: 20, r: 40, b: 60, l: 60 },
      xaxis: { title: 'Customer Lifetime Value ($)' },
      yaxis: { title: 'Number of Customers' },
      plot_bgcolor: 'rgba(0,0,0,0)',
      paper_bgcolor: 'rgba(0,0,0,0)',
      font: { family: 'inherit' }
    };
    
    Plotly.newPlot('clvChart', [trace], layout, { responsive: true, displayModeBar: false });
  } catch (error) {
    console.error('Error rendering CLV chart:', error);
  }
}

async function renderFrequencyChart() {
  try {
    const res = await fetch(`${API_BASE}/rfm${buildQuery({ k: 4 })}`);
    const data = await res.json();
    
    const freqBuckets = { '1': 0, '2-3': 0, '4-5': 0, '6-10': 0, '10+': 0 };
    
    data.forEach(d => {
      const freq = d.Frequency;
      if (freq === 1) freqBuckets['1']++;
      else if (freq <= 3) freqBuckets['2-3']++;
      else if (freq <= 5) freqBuckets['4-5']++;
      else if (freq <= 10) freqBuckets['6-10']++;
      else freqBuckets['10+']++;
    });
    
    const trace = {
      labels: Object.keys(freqBuckets),
      values: Object.values(freqBuckets),
      type: 'pie',
      hole: 0.4,
      marker: {
        colors: ['#ef4444', '#f59e0b', '#eab308', '#10b981', '#06b6d4']
      }
    };
    
    const layout = {
      margin: { t: 20, r: 20, b: 20, l: 20 },
      plot_bgcolor: 'rgba(0,0,0,0)',
      paper_bgcolor: 'rgba(0,0,0,0)',
      font: { family: 'inherit' }
    };
    
    Plotly.newPlot('frequencyChart', [trace], layout, { responsive: true, displayModeBar: false });
  } catch (error) {
    console.error('Error rendering frequency chart:', error);
  }
}

async function renderCohortChart() {
  try {
    const res = await fetch(`${API_BASE}/transactions${buildQuery(currentFilters)}`);
    const transactions = await res.json();
    
    // Simple cohort: group by month
    const cohorts = {};
    transactions.forEach(t => {
      if (t.InvoiceDate && t.CustomerID) {
        const month = t.InvoiceDate.substring(0, 7);
        if (!cohorts[month]) cohorts[month] = new Set();
        cohorts[month].add(t.CustomerID);
      }
    });
    
    const months = Object.keys(cohorts).sort().slice(0, 12);
    const sizes = months.map(m => cohorts[m].size);
    
    const trace = {
      x: months,
      y: sizes,
      type: 'scatter',
      mode: 'lines+markers',
      fill: 'tozeroy',
      line: { color: '#8b5cf6', width: 3 },
      marker: { size: 8, color: '#6366f1' }
    };
    
    const layout = {
      margin: { t: 20, r: 40, b: 60, l: 60 },
      xaxis: { title: 'Month', tickangle: -45 },
      yaxis: { title: 'Active Customers' },
      plot_bgcolor: 'rgba(0,0,0,0)',
      paper_bgcolor: 'rgba(0,0,0,0)',
      font: { family: 'inherit' }
    };
    
    Plotly.newPlot('cohortChart', [trace], layout, { responsive: true, displayModeBar: false });
  } catch (error) {
    console.error('Error rendering cohort chart:', error);
  }
}

async function renderForecastChart() {
  try {
    const res = await fetch(`${API_BASE}/monthly_trend${buildQuery(currentFilters)}`);
    const data = await res.json();
    
    if (data.length < 3) {
      document.getElementById('forecastChart').innerHTML = '<p style="text-align: center; padding: 40px;">Not enough data for forecast</p>';
      return;
    }
    
    // Simple linear forecast
    const lastThree = data.slice(-3);
    const avgGrowth = lastThree.length >= 2 ? 
      (lastThree[lastThree.length - 1].Revenue - lastThree[0].Revenue) / lastThree.length : 0;
    
    const forecast = [];
    const lastMonth = data[data.length - 1];
    const lastDate = new Date(lastMonth.year_month + '-01');
    
    for (let i = 1; i <= 3; i++) {
      const nextDate = new Date(lastDate);
      nextDate.setMonth(nextDate.getMonth() + i);
      const yearMonth = nextDate.toISOString().substring(0, 7);
      forecast.push({
        year_month: yearMonth,
        Revenue: Math.max(0, lastMonth.Revenue + (avgGrowth * i))
      });
    }
    
    const historicalTrace = {
      x: data.map(d => d.year_month),
      y: data.map(d => d.Revenue),
      type: 'scatter',
      mode: 'lines+markers',
      name: 'Historical',
      line: { color: '#6366f1', width: 3 }
    };
    
    const forecastTrace = {
      x: forecast.map(d => d.year_month),
      y: forecast.map(d => d.Revenue),
      type: 'scatter',
      mode: 'lines+markers',
      name: 'Forecast',
      line: { color: '#f59e0b', width: 3, dash: 'dash' },
      marker: { symbol: 'diamond', size: 10 }
    };
    
    const layout = {
      margin: { t: 20, r: 40, b: 60, l: 80 },
      xaxis: { title: 'Month', tickangle: -45 },
      yaxis: { title: 'Revenue ($)', tickformat: '$,.0f' },
      plot_bgcolor: 'rgba(0,0,0,0)',
      paper_bgcolor: 'rgba(0,0,0,0)',
      font: { family: 'inherit' },
      showlegend: true
    };
    
    Plotly.newPlot('forecastChart', [historicalTrace, forecastTrace], layout, { responsive: true, displayModeBar: false });
  } catch (error) {
    console.error('Error rendering forecast chart:', error);
  }
}

async function renderAssociationChart() {
  try {
    const res = await fetch(`${API_BASE}/transactions${buildQuery(currentFilters)}`);
    const transactions = await res.json();
    
    // Find products bought together
    const invoices = {};
    transactions.forEach(t => {
      if (!invoices[t.Invoice]) invoices[t.Invoice] = [];
      invoices[t.Invoice].push(t.StockCode);
    });
    
    const associations = {};
    Object.values(invoices).forEach(items => {
      if (items.length > 1) {
        items.forEach(item1 => {
          items.forEach(item2 => {
            if (item1 !== item2) {
              const key = [item1, item2].sort().join('|');
              associations[key] = (associations[key] || 0) + 1;
            }
          });
        });
      }
    });
    
    const topPairs = Object.entries(associations)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    const trace = {
      y: topPairs.map(([pair]) => pair.replace('|', ' + ')),
      x: topPairs.map(([, count]) => count),
      type: 'bar',
      orientation: 'h',
      marker: { color: '#10b981' }
    };
    
    const layout = {
      margin: { t: 20, r: 40, b: 40, l: 150 },
      xaxis: { title: 'Times Bought Together' },
      plot_bgcolor: 'rgba(0,0,0,0)',
      paper_bgcolor: 'rgba(0,0,0,0)',
      font: { family: 'inherit' }
    };
    
    Plotly.newPlot('associationChart', [trace], layout, { responsive: true, displayModeBar: false });
  } catch (error) {
    console.error('Error rendering association chart:', error);
  }
}

// ===== EXPORT FUNCTIONS =====
async function exportData(format) {
  if (format === 'csv') {
    exportToCSV();
  } else if (format === 'pdf') {
    exportToPDF();
  }
}

function exportToCSV() {
  const data = currentTransactions;
  if (data.length === 0) {
    showAlert('No data to export', 'error');
    return;
  }
  
  const headers = ['Invoice', 'Date', 'StockCode', 'Description', 'Quantity', 'Price', 'CustomerID', 'Country', 'Revenue'];
  const rows = data.map(t => [
    t.Invoice || '',
    t.InvoiceDate || '',
    t.StockCode || '',
    t.Description || '',
    t.Quantity || 0,
    t.Price || 0,
    t.CustomerID || '',
    t.Country || '',
    (t.Quantity || 0) * (t.Price || 0)
  ]);
  
  let csv = headers.join(',') + '\n';
  rows.forEach(row => {
    csv += row.map(cell => `"${cell}"`).join(',') + '\n';
  });
  
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `retail_data_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  
  showAlert('CSV exported successfully!', 'success');
}

function exportToPDF() {
  showAlert('PDF export functionality coming soon!', 'info');
  // You can implement PDF export using jsPDF library
}

// ===== CHART UTILITIES =====
function toggleChartType(chartId) {
  showAlert('Chart type toggle coming soon!', 'info');
}

function downloadChart(chartId) {
  Plotly.downloadImage(chartId, {
    format: 'png',
    width: 1200,
    height: 800,
    filename: `${chartId}_${new Date().toISOString().split('T')[0]}`
  });
  showAlert('Chart downloaded!', 'success');
}