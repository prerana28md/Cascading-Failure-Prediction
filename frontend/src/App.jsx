import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import ProductCatalog from './components/ProductCatalog';
import CreateOrderModal from './components/CreateOrderModal';
import OrdersList from './components/OrdersList';
import InventoryList from './components/InventoryList';
import PaymentsList from './components/PaymentsList';
import ShipmentsList from './components/ShipmentsList';
import DeliveriesList from './components/DeliveriesList';
import NotificationsList from './components/NotificationsList';
import OrderTracker from './components/OrderTracker';
import CartDrawer from './components/CartDrawer';
import CheckoutModal from './components/CheckoutModal';
import AuthModal from './components/AuthModal';
import { api } from './services/api';
import { AlertTriangle, AlertCircle, RefreshCw } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('products');
  const [userRole, setUserRole] = useState('ADMIN'); // Roles: 'ADMIN', 'CUSTOMER', 'INVENTORY_MANAGER', 'LOGISTICS_AGENT'
  const [viewMode, setViewMode] = useState('STOREFRONT'); // 'STOREFRONT' | 'OPERATIONS'
  const [gatewayStatus, setGatewayStatus] = useState('CHECKING');
  const [isMock, setIsMock] = useState(false);
  const [servicesHealth, setServicesHealth] = useState({});
  const [activeFaults, setActiveFaults] = useState([]);

  // Customer Shopping Cart State
  const [cartItems, setCartItems] = useState(() => {
    try {
      const saved = localStorage.getItem('omnistore_cart');
      return saved ? JSON.parse(saved) : [];
    } catch (_) {
      return [];
    }
  });
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [checkoutData, setCheckoutData] = useState(null);

  // Customer Authentication State
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState(() => api.getCurrentUser());

  // Data states
  const [inventory, setInventory] = useState([]);
  const [orders, setOrders] = useState([]);
  const [payments, setPayments] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [notifications, setNotifications] = useState([]);

  // Loading & Error states
  const [loading, setLoading] = useState({
    inventory: false,
    orders: false,
    payments: false,
    shipments: false,
    deliveries: false,
    notifications: false,
  });
  const [errors, setErrors] = useState({});

  // Modals & Selected state
  const [selectedProductForOrder, setSelectedProductForOrder] = useState(null);
  const [isCreateOrderOpen, setIsCreateOrderOpen] = useState(false);
  const [selectedOrderToTrack, setSelectedOrderToTrack] = useState(null);

  // Sync Cart to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('omnistore_cart', JSON.stringify(cartItems));
    } catch (_) {}
  }, [cartItems]);

  // Initial Data Load & Gateway Check + Polling
  useEffect(() => {
    // Automatically ensure customer session exists so all microservice requests carry valid token
    api.ensureSession().then((user) => {
      if (user) setCurrentUser(user);
      checkHealth();
      fetchAllData();
    });

    // Poll health and fault states every 5 seconds
    const intervalId = setInterval(() => {
      checkHealth();
    }, 5000);

    return () => clearInterval(intervalId);
  }, []);

  // When Role changes, switch active tab if current tab is restricted
  const handleRoleChange = (newRole) => {
    setUserRole(newRole);
    if (newRole === 'CUSTOMER' && ['inventory', 'payments', 'shipping', 'delivery', 'notifications'].includes(activeTab)) {
      setActiveTab('products');
    } else if (newRole === 'INVENTORY_MANAGER' && ['create-order', 'orders', 'payments', 'shipping', 'delivery', 'notifications', 'order-tracking'].includes(activeTab)) {
      setActiveTab('inventory');
    } else if (newRole === 'LOGISTICS_AGENT' && ['products', 'create-order', 'orders', 'inventory', 'payments', 'notifications'].includes(activeTab)) {
      setActiveTab('shipping');
    }
  };

  const handleToggleViewMode = () => {
    const nextMode = viewMode === 'STOREFRONT' ? 'OPERATIONS' : 'STOREFRONT';
    setViewMode(nextMode);
    if (nextMode === 'STOREFRONT') {
      if (!['products', 'orders', 'order-tracking'].includes(activeTab)) {
        setActiveTab('products');
      }
    }
  };

  const checkHealth = async () => {
    const res = await api.checkGatewayHealth();
    if (res && !res.error && res.status === 200) {
      setGatewayStatus('UP');
      setIsMock(false);
    } else {
      setGatewayStatus(res && res.error ? 'DOWN' : 'CHECKING');
      setIsMock(Boolean(res && res.isMock));
    }

    // Check fault status across all 6 microservices
    const healthRes = await api.checkAllServicesHealth();
    if (healthRes && healthRes.data) {
      setServicesHealth(healthRes.data);
      const faults = Object.values(healthRes.data).filter(s => s.fault && s.fault !== 'NONE');
      setActiveFaults(faults);
    }
  };

  const fetchAllData = async () => {
    fetchInventory();
    fetchOrders();
    fetchPayments();
    fetchShipments();
    fetchDeliveries();
    fetchNotifications();
  };

  const fetchInventory = async () => {
    setLoading(prev => ({ ...prev, inventory: true }));
    const res = await api.getInventory();
    setLoading(prev => ({ ...prev, inventory: false }));
    if (res.data) {
      setInventory(res.data);
      setErrors(prev => ({ ...prev, inventory: null }));
    }
    if (res.error) {
      setErrors(prev => ({ ...prev, inventory: res.error }));
      if (res.isFault) {
        setInventory([]);
      }
    }
  };

  const fetchOrders = async () => {
    setLoading(prev => ({ ...prev, orders: true }));
    const res = await api.getOrders();
    setLoading(prev => ({ ...prev, orders: false }));
    if (res.data) {
      setOrders(res.data);
      setErrors(prev => ({ ...prev, orders: null }));
    }
    if (res.error) {
      setErrors(prev => ({ ...prev, orders: res.error }));
      if (res.isFault) {
        setOrders([]);
      }
    }
  };

  const fetchPayments = async () => {
    setLoading(prev => ({ ...prev, payments: true }));
    const res = await api.getPayments();
    setLoading(prev => ({ ...prev, payments: false }));
    if (res.data) {
      setPayments(res.data);
      setErrors(prev => ({ ...prev, payments: null }));
    }
    if (res.error) {
      setErrors(prev => ({ ...prev, payments: res.error }));
      if (res.isFault) {
        setPayments([]);
      }
    }
  };

  const fetchShipments = async () => {
    setLoading(prev => ({ ...prev, shipments: true }));
    const res = await api.getShipments();
    setLoading(prev => ({ ...prev, shipments: false }));
    if (res.data) {
      setShipments(res.data);
      setErrors(prev => ({ ...prev, shipments: null }));
    }
    if (res.error) {
      setErrors(prev => ({ ...prev, shipments: res.error }));
      if (res.isFault) {
        setShipments([]);
      }
    }
  };

  const fetchDeliveries = async () => {
    setLoading(prev => ({ ...prev, deliveries: true }));
    const res = await api.getDeliveries();
    setLoading(prev => ({ ...prev, deliveries: false }));
    if (res.data) {
      setDeliveries(res.data);
      setErrors(prev => ({ ...prev, deliveries: null }));
    }
    if (res.error) {
      setErrors(prev => ({ ...prev, deliveries: res.error }));
      if (res.isFault) {
        setDeliveries([]);
      }
    }
  };

  const fetchNotifications = async () => {
    setLoading(prev => ({ ...prev, notifications: true }));
    const res = await api.getNotifications();
    setLoading(prev => ({ ...prev, notifications: false }));
    if (res.data) {
      setNotifications(res.data);
      setErrors(prev => ({ ...prev, notifications: null }));
    }
    if (res.error) {
      setErrors(prev => ({ ...prev, notifications: res.error }));
      if (res.isFault) {
        setNotifications([]);
      }
    }
  };

  // ── Cart Handlers ─────────────────────────────────────────────────────────
  const handleAddToCart = (product, quantity = 1) => {
    setCartItems(prev => {
      const pId = product.productId || product.id;
      const existing = prev.find(item => (item.product.productId || item.product.id) === pId);
      if (existing) {
        return prev.map(item =>
          (item.product.productId || item.product.id) === pId
            ? { ...item, quantity: item.quantity + quantity }
            : item
        );
      }
      return [...prev, { product, quantity }];
    });
  };

  const handleUpdateCartQuantity = (productId, newQuantity) => {
    setCartItems(prev =>
      prev
        .map(item =>
          (item.product.productId || item.product.id) === productId
            ? { ...item, quantity: newQuantity }
            : item
        )
        .filter(item => item.quantity > 0)
    );
  };

  const handleRemoveFromCart = (productId) => {
    setCartItems(prev =>
      prev.filter(item => (item.product.productId || item.product.id) !== productId)
    );
  };

  const handleClearCart = () => {
    setCartItems([]);
  };

  // Direct "Buy Now" flow
  const handleBuyNow = (product, quantity = 1) => {
    const price = Number(product.price || 0);
    const sub = price * quantity;
    const ship = sub > 150 ? 0 : 15;
    const tax = sub * 0.08;
    const tot = sub + ship + tax;
    setCheckoutData({
      cartItems: [{ product, quantity }],
      subtotal: sub,
      shipping: ship,
      discountAmount: 0,
      tax: tax,
      total: tot
    });
    setIsCheckoutOpen(true);
  };

  const handleOpenCheckoutFromCart = (data) => {
    setCheckoutData(data);
    setIsCartOpen(false);
    setIsCheckoutOpen(true);
  };

  // ── Auth Handlers ─────────────────────────────────────────────────────────
  const handleLoginSuccess = (user) => {
    setCurrentUser(user);
    if (user?.role === 'ADMIN') {
      setUserRole('ADMIN');
    } else {
      setUserRole('CUSTOMER');
    }
  };

  const handleLogout = () => {
    api.logout();
    setCurrentUser(null);
  };

  // ── Order Creation & Tracking ─────────────────────────────────────────────
  const handleOpenOrderModal = (product = null) => {
    setSelectedProductForOrder(product);
    setIsCreateOrderOpen(true);
  };

  const handleCreateOrderSubmit = async (orderPayload) => {
    const res = await api.createOrder(orderPayload);
    if (res && res.data) {
      fetchAllData();
    }
    return res;
  };

  const handleCheckoutSubmitOrder = async (orderPayload) => {
    const res = await api.createOrder(orderPayload);
    if (res && res.data) {
      handleClearCart();
      fetchAllData();
    }
    return res;
  };

  const handleCreateInventoryItem = async (item) => {
    const res = await api.createInventoryItem(item);
    if (res && res.data) {
      fetchInventory();
    }
    return res;
  };

  const handleDeductStock = async (productId, quantity) => {
    fetchInventory();
    return { data: { status: 'SUCCESS' }, error: null };
  };

  const handleSelectTrackOrder = (order) => {
    setSelectedOrderToTrack(order);
    setActiveTab('order-tracking');
  };

  const handleTabChange = (tabId) => {
    if (tabId === 'create-order') {
      setIsCreateOrderOpen(true);
    } else {
      setActiveTab(tabId);
    }
  };

  const totalCartCount = cartItems.reduce((acc, item) => acc + item.quantity, 0);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      
      {/* Navigation Bar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={handleTabChange}
        gatewayStatus={gatewayStatus}
        isMock={isMock}
        userRole={userRole}
        setUserRole={handleRoleChange}
        servicesHealth={servicesHealth}
        activeFaults={activeFaults}
        cartCount={totalCartCount}
        onOpenCart={() => setIsCartOpen(true)}
        currentUser={currentUser}
        onOpenAuth={() => setIsAuthOpen(true)}
        onLogout={handleLogout}
        viewMode={viewMode}
        onToggleViewMode={handleToggleViewMode}
      />

      {/* Global Microservice Outage / Degradation Alert Banner */}
      {activeFaults.length > 0 && (
        <div className="bg-rose-950/95 border-b border-rose-800/90 px-4 sm:px-8 py-3 text-xs shadow-lg animate-pulse">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start sm:items-center space-x-3 text-rose-200">
              <span className="px-2 py-0.5 rounded bg-rose-900 border border-rose-700 text-rose-300 font-extrabold uppercase tracking-wider text-[10px] shrink-0 mt-0.5 sm:mt-0">
                SERVICE OUTAGE
              </span>
              <span>
                <strong>{activeFaults.map(f => f.name).join(', ')}</strong> has an active fault (
                {activeFaults.map(f => `${f.service}: ${f.fault}${f.delayMs ? ` +${f.delayMs}ms` : ''}`).join(', ')}
                ). Associated operations such as checkout, payments, stock deduction, and shipping may fail or time out.
              </span>
            </div>
            <button
              onClick={() => { checkHealth(); fetchAllData(); }}
              className="flex items-center space-x-1 text-rose-300 hover:text-white underline font-semibold shrink-0 self-end sm:self-center cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Refresh Status</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'products' && (
          <ProductCatalog
            inventory={inventory}
            loading={loading.inventory}
            error={errors.inventory}
            serviceHealth={servicesHealth.inventory}
            onRefresh={fetchInventory}
            onAddToCart={handleAddToCart}
            onBuyNow={handleBuyNow}
            onOrderProduct={handleOpenOrderModal}
            onOpenAddProduct={() => setActiveTab('inventory')}
            userRole={userRole}
          />
        )}

        {activeTab === 'orders' && (
          <OrdersList
            orders={orders}
            loading={loading.orders}
            error={errors.orders}
            serviceHealth={servicesHealth.order}
            onRefresh={fetchOrders}
            onSelectTrackOrder={handleSelectTrackOrder}
            userRole={userRole}
          />
        )}

        {activeTab === 'inventory' && (
          <InventoryList
            inventory={inventory}
            loading={loading.inventory}
            error={errors.inventory}
            serviceHealth={servicesHealth.inventory}
            onRefresh={fetchInventory}
            onCreateItem={handleCreateInventoryItem}
            onDeductStock={handleDeductStock}
            userRole={userRole}
          />
        )}

        {activeTab === 'payments' && (
          <PaymentsList
            payments={payments}
            loading={loading.payments}
            error={errors.payments}
            serviceHealth={servicesHealth.payment}
            onRefresh={fetchPayments}
            userRole={userRole}
          />
        )}

        {activeTab === 'shipping' && (
          <ShipmentsList
            shipments={shipments}
            loading={loading.shipments}
            error={errors.shipping}
            serviceHealth={servicesHealth.shipping}
            onRefresh={fetchShipments}
            userRole={userRole}
          />
        )}

        {activeTab === 'delivery' && (
          <DeliveriesList
            deliveries={deliveries}
            loading={loading.deliveries}
            error={errors.delivery}
            serviceHealth={servicesHealth.delivery}
            onRefresh={fetchDeliveries}
            userRole={userRole}
          />
        )}

        {activeTab === 'notifications' && (
          <NotificationsList
            notifications={notifications}
            loading={loading.notifications}
            error={errors.notification}
            serviceHealth={servicesHealth.notification}
            onRefresh={fetchNotifications}
            userRole={userRole}
          />
        )}

        {activeTab === 'order-tracking' && (
          <OrderTracker
            orders={orders}
            selectedOrder={selectedOrderToTrack}
            payments={payments}
            shipments={shipments}
            deliveries={deliveries}
            notifications={notifications}
            servicesHealth={servicesHealth}
            userRole={userRole}
          />
        )}
      </main>

      {/* Cart Drawer */}
      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cartItems={cartItems}
        onUpdateQuantity={handleUpdateCartQuantity}
        onRemoveItem={handleRemoveFromCart}
        onClearCart={handleClearCart}
        onOpenCheckout={handleOpenCheckoutFromCart}
        servicesHealth={servicesHealth}
      />

      {/* Customer Checkout Modal */}
      <CheckoutModal
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
        checkoutData={checkoutData}
        currentUser={currentUser}
        servicesHealth={servicesHealth}
        onSubmitOrder={handleCheckoutSubmitOrder}
        onOpenOrderTracker={(order) => {
          if (order) setSelectedOrderToTrack(order);
          setActiveTab('order-tracking');
        }}
      />

      {/* Customer Authentication Modal */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onLoginSuccess={handleLoginSuccess}
      />

      {/* Create Order Modal (Direct Admin/Single Product Order) */}
      <CreateOrderModal
        isOpen={isCreateOrderOpen}
        onClose={() => setIsCreateOrderOpen(false)}
        selectedProduct={selectedProductForOrder}
        inventory={inventory}
        servicesHealth={servicesHealth}
        activeFaults={activeFaults}
        onSubmitOrder={handleCreateOrderSubmit}
      />

      {/* Global Footer */}
      <footer className="bg-slate-900/60 border-t border-slate-800 py-6 text-center text-xs text-slate-500">
        <p>
          OmniStore Microservices Platform &bull; API Gateway: <code className="text-indigo-400">http://localhost:8080</code> &bull; Mode: <span className="text-indigo-300 font-bold">{viewMode}</span> &bull; Active Role: <span className="text-emerald-300 font-bold">{userRole}</span>
        </p>
      </footer>
    </div>
  );
}
