// Centralized API Service for Microservice API Gateway
//
// Dev mode  (npm run dev):  hits http://localhost:8080 directly
// Docker / production:      hits /api/* which nginx proxies to api-gateway:8080
//
// Set VITE_API_BASE_URL in .env.production to override (leave blank → uses /api)

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.PROD ? '/api' : 'http://localhost:8080');

// Initial offline seed data (strictly for cold start when backend is entirely offline)
const mockData = {
  inventory: [
    { id: 1, productId: 101, productName: 'Wireless Noise-Canceling Headphones', price: 199.99, quantity: 45 },
    { id: 2, productId: 102, productName: 'Ultra HD Curved Monitor 27"', price: 349.50, quantity: 18 },
    { id: 3, productId: 103, productName: 'Mechanical RGB Keyboard', price: 89.99, quantity: 60 },
    { id: 4, productId: 104, productName: 'Ergonomic Gaming Mouse', price: 49.99, quantity: 30 },
    { id: 5, productId: 105, productName: 'USB-C Multi-Port Hub', price: 35.00, quantity: 100 },
  ],
  orders: [
    { id: 1001, customerId: 501, productId: 101, quantity: 1, amount: 199.99, status: 'COMPLETED', createdAt: new Date(Date.now() - 3600000).toISOString() },
    { id: 1002, customerId: 502, productId: 103, quantity: 2, amount: 179.98, status: 'COMPLETED', createdAt: new Date(Date.now() - 7200000).toISOString() },
  ],
  payments: [
    { id: 2001, orderId: 1001, amount: 199.99, paymentMethod: 'CREDIT_CARD', status: 'SUCCESS', transactionDate: new Date(Date.now() - 3550000).toISOString() },
    { id: 2002, orderId: 1002, amount: 179.98, paymentMethod: 'CREDIT_CARD', status: 'SUCCESS', transactionDate: new Date(Date.now() - 7150000).toISOString() },
  ],
  shipments: [
    { id: 3001, orderId: 1001, address: '742 Evergreen Terrace, Springfield', status: 'SHIPPED', shippedDate: new Date(Date.now() - 3500000).toISOString() },
    { id: 3002, orderId: 1002, address: '123 Tech Boulevard, Silicon Valley', status: 'SHIPPED', shippedDate: new Date(Date.now() - 7100000).toISOString() },
  ],
  deliveries: [
    { id: 4001, shipmentId: 3001, status: 'IN_TRANSIT', estimatedDelivery: '1-2 business days', lastLocation: 'Distribution Hub East' },
    { id: 4002, shipmentId: 3002, status: 'DELIVERED', estimatedDelivery: 'Delivered', lastLocation: 'Front Door' },
  ],
  notifications: [
    { id: 5001, userId: 501, type: 'ORDER_SUCCESS', message: 'Order #1001 placed and processed successfully!', status: 'SENT', timestamp: new Date(Date.now() - 3500000).toISOString() },
    { id: 5002, userId: 501, type: 'PAYMENT_CONFIRMATION', message: 'Payment of $199.99 processed for Order #1001', status: 'SENT', timestamp: new Date(Date.now() - 3550000).toISOString() },
    { id: 5003, userId: 502, type: 'SHIPPING_UPDATE', message: 'Shipment created for Order #1002 with ID 3002', status: 'SENT', timestamp: new Date(Date.now() - 7100000).toISOString() },
  ]
};

let isAuthenticating = null;

async function getOrInitToken() {
  let token = typeof window !== 'undefined' ? localStorage.getItem('omnistore_token') : null;
  if (token) return token;

  if (isAuthenticating) return isAuthenticating;

  isAuthenticating = (async () => {
    try {
      // 1. Try logging in with demo customer credentials
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'password123' })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.token) {
          localStorage.setItem('omnistore_token', data.token);
          localStorage.setItem('omnistore_user', JSON.stringify({
            username: data.username || 'alice',
            role: data.role || 'USER'
          }));
          return data.token;
        }
      }

      // 2. If user does not exist, register them
      const reg = await fetch(`${API_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'password123', role: 'USER' })
      });
      if (reg.ok) {
        const data = await reg.json();
        if (data.token) {
          localStorage.setItem('omnistore_token', data.token);
          localStorage.setItem('omnistore_user', JSON.stringify({
            username: data.username || 'alice',
            role: data.role || 'USER'
          }));
          return data.token;
        }
      }
    } catch (e) {
      console.warn('[Auto-Auth] Could not obtain automatic token:', e);
    } finally {
      isAuthenticating = null;
    }
    return null;
  })();

  return isAuthenticating;
}

// Generic HTTP request wrapper with genuine error propagation & offline demo fallback
async function request(endpoint, options = {}, mockKey = null, retryCount = 0) {
  const url = `${API_BASE_URL}${endpoint}`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    let token = typeof window !== 'undefined' ? localStorage.getItem('omnistore_token') : null;
    // Auto-acquire token if missing and calling protected microservice endpoint
    if (!token && !endpoint.startsWith('/auth') && !endpoint.startsWith('/fault') && !endpoint.startsWith('/gateway')) {
      token = await getOrInitToken();
    }

    const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {};

    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...authHeaders,
        ...options.headers,
      },
      signal: controller.signal,
      ...options,
    });

    clearTimeout(timeoutId);

    // If 401 or 403 (unauthorized/forbidden), token may be expired or missing
    if ((response.status === 401 || response.status === 403) && retryCount === 0 && !endpoint.startsWith('/auth')) {
      if (typeof window !== 'undefined') localStorage.removeItem('omnistore_token');
      token = await getOrInitToken();
      if (token) {
        return request(endpoint, options, mockKey, 1);
      }
    }

    // If HTTP error (e.g. 500, 503, 400, 404, etc.):
    if (!response.ok) {
      let errorMsg = `HTTP ${response.status}: ${response.statusText}`;
      let serviceName = null;
      let errorStatus = response.status;
      try {
        const errorJson = await response.json();
        if (errorJson) {
          serviceName = errorJson.service || null;
          errorMsg = errorJson.message || errorJson.error || errorMsg;
        }
      } catch (_) {
        try {
          const errorText = await response.text();
          if (errorText) errorMsg = errorText;
        } catch (_) {}
      }

      console.error(`[API Error] ${options.method || 'GET'} ${endpoint} -> ${response.status}: ${errorMsg}`);
      
      const isAuthError = response.status === 401 || response.status === 403;
      return {
        data: null,
        error: isAuthError ? 'Authentication required. Please sign in.' : errorMsg,
        status: errorStatus,
        service: serviceName,
        isFault: !isAuthError, // 401/403 is security authentication, NOT a microservice outage!
        isAuthRequired: isAuthError,
        isMock: false
      };
    }

    const data = await response.json();
    return { data, error: null, status: 200, isFault: false, isMock: false };

  } catch (err) {
    const isAbort = err.name === 'AbortError';
    const errMessage = isAbort ? 'Request timed out (Latency / Network delay)' : err.message;
    console.warn(`[Network Warning] ${options.method || 'GET'} ${endpoint} failed: ${errMessage}`);

    // If this is a mutation (POST, PUT, DELETE), NEVER fake success!
    const method = (options.method || 'GET').toUpperCase();
    if (method !== 'GET') {
      return {
        data: null,
        error: `Action failed: ${errMessage}`,
        status: isAbort ? 504 : 0,
        isFault: true,
        isMock: false
      };
    }

    // Only for GET queries, if completely offline and initial mockData is available, return mockData
    // BUT explicitly provide error and isMock: true so UI knows it is offline!
    if (mockKey && mockData[mockKey]) {
      return {
        data: mockData[mockKey],
        error: `Backend unreachable (${errMessage}). Showing offline mock data.`,
        status: 0,
        isFault: false,
        isMock: true,
        isOffline: true
      };
    }

    return { data: null, error: errMessage, status: 0, isFault: true, isMock: false };
  }
}

export const api = {
  // ── Authentication (order-service /auth/** via API Gateway) ───────────
  async login(username, password) {
    const res = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (res.data && res.data.token) {
      localStorage.setItem('omnistore_token', res.data.token);
      localStorage.setItem('omnistore_user', JSON.stringify({
        username: res.data.username || username,
        role: res.data.role || 'USER',
      }));
    }
    return res;
  },

  async register(username, password, role = 'USER') {
    const res = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, role }),
    });
    if (res.data && res.data.token) {
      localStorage.setItem('omnistore_token', res.data.token);
      localStorage.setItem('omnistore_user', JSON.stringify({
        username: res.data.username || username,
        role: res.data.role || role,
      }));
    }
    return res;
  },

  async getMe() {
    return request('/auth/me', { method: 'GET' });
  },

  getCurrentUser() {
    try {
      const user = localStorage.getItem('omnistore_user');
      return user ? JSON.parse(user) : null;
    } catch (_) {
      return null;
    }
  },

  logout() {
    localStorage.removeItem('omnistore_token');
    localStorage.removeItem('omnistore_user');
  },

  async ensureSession() {
    let user = this.getCurrentUser();
    let token = typeof window !== 'undefined' ? localStorage.getItem('omnistore_token') : null;
    if (user && token) return user;
    await getOrInitToken();
    return this.getCurrentUser();
  },

  async demoLogin(role = 'CUSTOMER') {
    const username = role === 'ADMIN' ? 'admin' : 'customer';
    const password = 'password123';
    // 1. Try login first
    const loginRes = await this.login(username, password);
    if (loginRes.data && !loginRes.error) {
      return loginRes;
    }
    // 2. If login fails (user does not exist yet), register user
    const regRes = await this.register(username, password, role === 'ADMIN' ? 'ADMIN' : 'USER');
    if (regRes.data && !regRes.error) {
      return regRes;
    }
    // 3. Fallback demo session if backend is completely cold
    const fallbackUser = { username, role: role === 'ADMIN' ? 'ADMIN' : 'CUSTOMER' };
    localStorage.setItem('omnistore_user', JSON.stringify(fallbackUser));
    return { data: fallbackUser, error: null, isMock: true };
  },

  // Check API Gateway connection health
  async checkGatewayHealth() {
    return request('/gateway/health', { method: 'GET' });
  },

  // Central fault status for all 6 microservices
  async getFaultStatus() {
    return request('/fault/status', { method: 'GET' });
  },

  // Check health and fault state of all 6 services
  async checkAllServicesHealth() {
    const services = ['order', 'payment', 'inventory', 'shipping', 'delivery', 'notification'];
    try {
      const res = await request('/fault/status', { method: 'GET' });
      if (res && res.data && typeof res.data === 'object') {
        const sMap = {};
        if (Array.isArray(res.data.services)) {
          res.data.services.forEach(item => {
            const raw = item.service || item.name || '';
            sMap[raw] = item;
            sMap[raw.replace(/-service$/, '')] = item;
          });
        }
        Object.keys(res.data).forEach(k => {
          if (k !== 'services') {
            sMap[k] = res.data[k];
            sMap[k.replace(/-service$/, '')] = res.data[k];
          }
        });

        const out = {};
        for (const s of services) {
          const sData = sMap[s] || sMap[`${s}-service`] || {};
          const fault = String(sData.fault || sData.faultType || 'NONE').toUpperCase();
          out[s] = {
            service: s,
            name: `${s.charAt(0).toUpperCase() + s.slice(1)} Service`,
            fault: fault,
            delayMs: Number(sData.delayMs || sData.delay_ms || 0),
            status: fault === 'DOWN' ? 'DOWN' : (fault === 'ERROR' || fault === 'LATENCY' ? 'DEGRADED' : 'HEALTHY'),
          };
        }
        return { data: out, error: null };
      }
    } catch (_) {}

    return { data: null, error: 'Fault status check failed' };
  },

  // 1. Inventory & Products
  async getInventory() {
    return request('/inventory', { method: 'GET' }, 'inventory');
  },
  async getInventoryById(id) {
    return request(`/inventory/${id}`, { method: 'GET' });
  },
  async createInventoryItem(item) {
    return request('/inventory', {
      method: 'POST',
      body: JSON.stringify(item),
    });
  },

  // 2. Orders
  async getOrders() {
    return request('/orders', { method: 'GET' }, 'orders');
  },
  async getOrderById(id) {
    return request(`/orders/${id}`, { method: 'GET' });
  },
  async createOrder(orderData) {
    return request('/orders', {
      method: 'POST',
      body: JSON.stringify(orderData),
    });
  },

  // 3. Payments
  async getPayments() {
    return request('/payments', { method: 'GET' }, 'payments');
  },
  async getPaymentById(id) {
    return request(`/payments/${id}`, { method: 'GET' });
  },

  // 4. Shipping
  async getShipments() {
    return request('/shipments', { method: 'GET' }, 'shipments');
  },

  // 5. Delivery
  async getDeliveries() {
    return request('/deliveries', { method: 'GET' }, 'deliveries');
  },

  // 6. Notifications
  async getNotifications() {
    return request('/notifications', { method: 'GET' }, 'notifications');
  }
};
