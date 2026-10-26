import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import ProductCatalog from './components/ProductCatalog';
import OrdersList from './components/OrdersList';
import OrderTracker from './components/OrderTracker';
import CartDrawer from './components/CartDrawer';
import CheckoutModal from './components/CheckoutModal';
import AuthModal from './components/AuthModal';
import { api } from './services/api';
export default function App() {
  const [activeTab, setActiveTab] = useState('products');

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
  const [selectedOrderToTrack, setSelectedOrderToTrack] = useState(null);

  // Sync Cart to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('omnistore_cart', JSON.stringify(cartItems));
    } catch (_) {}
  }, [cartItems]);

  // Load the customer session and storefront data.
  useEffect(() => {
    api.ensureSession().then((user) => {
      if (user) setCurrentUser(user);
      fetchAllData();
    });
  }, []);

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
  };

  const handleLogout = () => {
    api.logout();
    setCurrentUser(null);
  };

  // ── Order Creation & Tracking ─────────────────────────────────────────────
  const handleCheckoutSubmitOrder = async (orderPayload) => {
    const res = await api.createOrder(orderPayload);
    if (res && res.data) {
      handleClearCart();
      fetchAllData();
    }
    return res;
  };

  const handleSelectTrackOrder = (order) => {
    setSelectedOrderToTrack(order);
    setActiveTab('order-tracking');
  };

  const totalCartCount = cartItems.reduce((acc, item) => acc + item.quantity, 0);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      
      {/* Navigation Bar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        cartCount={totalCartCount}
        onOpenCart={() => setIsCartOpen(true)}
        currentUser={currentUser}
        onOpenAuth={() => setIsAuthOpen(true)}
        onLogout={handleLogout}
      />

      {/* Main Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'products' && (
          <ProductCatalog
            inventory={inventory}
            loading={loading.inventory}
            error={errors.inventory}
            onRefresh={fetchInventory}
            onAddToCart={handleAddToCart}
            onBuyNow={handleBuyNow}
            userRole="CUSTOMER"
          />
        )}

        {activeTab === 'orders' && (
          <OrdersList
            orders={orders}
            loading={loading.orders}
            error={errors.orders}
            onRefresh={fetchOrders}
            onSelectTrackOrder={handleSelectTrackOrder}
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
      />

      {/* Customer Checkout Modal */}
      <CheckoutModal
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
        checkoutData={checkoutData}
        currentUser={currentUser}
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

      {/* Global Footer */}
      <footer className="bg-slate-900/60 border-t border-slate-800 py-6 text-center text-xs text-slate-500">
        <p>OmniStore · Your shopping, made simple.</p>
      </footer>
    </div>
  );
}
