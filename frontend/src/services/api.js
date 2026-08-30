// Centralized API Service for Microservice API Gateway
//
// Dev mode  (npm run dev):  hits http://localhost:8080 directly
// Docker / production:      hits /api/* which nginx proxies to api-gateway:8080
//
// Set VITE_API_BASE_URL in .env.production to override (leave blank → uses /api)

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.PROD ? '/api' : 'http://localhost:8080');

// Fallback Mock Storage in memory for seamless offline presentation
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

// Generic HTTP request wrapper with graceful error handling & mock fallback
async function request(endpoint, options = {}, mockKey = null, fallbackFn = null) {
  const url = `${API_BASE_URL}${endpoint}`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout for fast response check

    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...options.headers,
      },
      signal: controller.signal,
      ...options,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      let errorJson = null;
      try { errorJson = JSON.parse(errorText); } catch (_) {}
      throw new Error((errorJson && (errorJson.message || errorJson.error)) || `HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return { data, error: null, isMock: false };
  } catch (err) {
    console.warn(`API Gateway call to ${endpoint} failed/unreachable (${err.message}). Using local mock fallback.`);
    
    if (fallbackFn) {
      const fallbackResult = fallbackFn();
      return { data: fallbackResult, error: null, isMock: true };
    }

    if (mockKey && mockData[mockKey]) {
      return { data: mockData[mockKey], error: null, isMock: true };
    }

    return { data: null, error: err.message, isMock: true };
  }
}

export const api = {
  // Check API Gateway connection health
  async checkGatewayHealth() {
    return request('/gateway/health', { method: 'GET' }, null, () => ({ status: 'UP', message: 'Mock Gateway Active' }));
  },

  // 1. Inventory & Products
  async getInventory() {
    return request('/inventory', { method: 'GET' }, 'inventory');
  },
  async getInventoryById(id) {
    return request(`/inventory/${id}`, { method: 'GET' }, null, () => 
      mockData.inventory.find(i => i.id === Number(id) || i.productId === Number(id))
    );
  },
  async createInventoryItem(item) {
    return request('/inventory', {
      method: 'POST',
      body: JSON.stringify(item),
    }, null, () => {
      const newItem = {
        id: mockData.inventory.length + 1,
        productId: item.productId || Math.floor(100 + Math.random() * 900),
        productName: item.productName || 'New Product',
        price: Number(item.price) || 29.99,
        quantity: Number(item.quantity) || 10,
      };
      mockData.inventory.unshift(newItem);
      return newItem;
    });
  },

  // 2. Orders
  async getOrders() {
    return request('/orders', { method: 'GET' }, 'orders');
  },
  async getOrderById(id) {
    return request(`/orders/${id}`, { method: 'GET' }, null, () => 
      mockData.orders.find(o => o.id === Number(id))
    );
  },
  async createOrder(orderData) {
    return request('/orders', {
      method: 'POST',
      body: JSON.stringify(orderData),
    }, null, () => {
      const newOrderId = Math.floor(1000 + Math.random() * 9000);
      const newOrder = {
        id: newOrderId,
        customerId: Number(orderData.customerId) || 101,
        productId: Number(orderData.productId),
        quantity: Number(orderData.quantity),
        amount: Number(orderData.amount),
        status: 'COMPLETED',
        createdAt: new Date().toISOString()
      };
      mockData.orders.unshift(newOrder);

      // Simulate cascade effects in mock data
      // 1. Deduct Inventory stock
      const stockItem = mockData.inventory.find(i => i.productId === newOrder.productId);
      if (stockItem) {
        stockItem.quantity = Math.max(0, stockItem.quantity - newOrder.quantity);
      }
      // 2. Payment
      const newPayment = {
        id: Math.floor(2000 + Math.random() * 9000),
        orderId: newOrderId,
        amount: newOrder.amount,
        paymentMethod: 'CREDIT_CARD',
        status: 'SUCCESS',
        transactionDate: new Date().toISOString()
      };
      mockData.payments.unshift(newPayment);
      // 3. Shipping
      const newShipment = {
        id: Math.floor(3000 + Math.random() * 9000),
        orderId: newOrderId,
        address: orderData.shippingAddress || 'Default Customer Address',
        status: 'SHIPPED',
        shippedDate: new Date().toISOString()
      };
      mockData.shipments.unshift(newShipment);
      // 4. Delivery
      const newDelivery = {
        id: Math.floor(4000 + Math.random() * 9000),
        shipmentId: newShipment.id,
        status: 'ASSIGNED',
        estimatedDelivery: '3-5 business days',
        lastLocation: 'Fulfillment Center'
      };
      mockData.deliveries.unshift(newDelivery);
      // 5. Notification
      const newNotif = {
        id: Math.floor(5000 + Math.random() * 9000),
        userId: newOrder.customerId,
        type: 'ORDER_SUCCESS',
        message: `Order #${newOrderId} placed and processed successfully!`,
        status: 'SENT',
        timestamp: new Date().toISOString()
      };
      mockData.notifications.unshift(newNotif);

      return newOrder;
    });
  },

  // 3. Payments
  async getPayments() {
    return request('/payments', { method: 'GET' }, 'payments');
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
