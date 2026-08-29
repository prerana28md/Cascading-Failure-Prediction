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
import { api } from './services/api';

export default function App() {
  const [activeTab, setActiveTab] = useState('products');
  const [userRole, setUserRole] = useState('ADMIN'); // Roles: 'ADMIN', 'CUSTOMER', 'INVENTORY_MANAGER', 'LOGISTICS_AGENT'
  const [gatewayStatus, setGatewayStatus] = useState('CHECKING');
  const [isMock, setIsMock] = useState(false);

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

  // Initial Data Load & Gateway Check
  useEffect(() => {
    checkHealth();
    fetchAllData();
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

  const checkHealth = async () => {
    const res = await api.checkGatewayHealth();
    if (res && res.data && !res.isMock) {
      setGatewayStatus('UP');
      setIsMock(false);
    } else {
      setGatewayStatus('DOWN');
      setIsMock(true);
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
    if (res.data) setInventory(res.data);
    if (res.error) setErrors(prev => ({ ...prev, inventory: res.error }));
  };

  const fetchOrders = async () => {
    setLoading(prev => ({ ...prev, orders: true }));
    const res = await api.getOrders();
    setLoading(prev => ({ ...prev, orders: false }));
    if (res.data) setOrders(res.data);
    if (res.error) setErrors(prev => ({ ...prev, orders: res.error }));
  };

  const fetchPayments = async () => {
    setLoading(prev => ({ ...prev, payments: true }));
    const res = await api.getPayments();
    setLoading(prev => ({ ...prev, payments: false }));
    if (res.data) setPayments(res.data);
    if (res.error) setErrors(prev => ({ ...prev, payments: res.error }));
  };

  const fetchShipments = async () => {
    setLoading(prev => ({ ...prev, shipments: true }));
    const res = await api.getShipments();
    setLoading(prev => ({ ...prev, shipments: false }));
    if (res.data) setShipments(res.data);
    if (res.error) setErrors(prev => ({ ...prev, shipments: res.error }));
  };

  const fetchDeliveries = async () => {
    setLoading(prev => ({ ...prev, deliveries: true }));
    const res = await api.getDeliveries();
    setLoading(prev => ({ ...prev, deliveries: false }));
    if (res.data) setDeliveries(res.data);
    if (res.error) setErrors(prev => ({ ...prev, deliveries: res.error }));
  };

  const fetchNotifications = async () => {
    setLoading(prev => ({ ...prev, notifications: true }));
    const res = await api.getNotifications();
    setLoading(prev => ({ ...prev, notifications: false }));
    if (res.data) setNotifications(res.data);
    if (res.error) setErrors(prev => ({ ...prev, notifications: res.error }));
  };

  // Handlers
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Navigation Bar with Role-Based Access Control */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={handleTabChange}
        gatewayStatus={gatewayStatus}
        isMock={isMock}
        userRole={userRole}
        setUserRole={handleRoleChange}
      />

      {/* Main Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'products' && (
          <ProductCatalog
            inventory={inventory}
            loading={loading.inventory}
            error={errors.inventory}
            onRefresh={fetchInventory}
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
            onRefresh={fetchPayments}
            userRole={userRole}
          />
        )}

        {activeTab === 'shipping' && (
          <ShipmentsList
            shipments={shipments}
            loading={loading.shipments}
            error={errors.shipments}
            onRefresh={fetchShipments}
            userRole={userRole}
          />
        )}

        {activeTab === 'delivery' && (
          <DeliveriesList
            deliveries={deliveries}
            loading={loading.deliveries}
            error={errors.deliveries}
            onRefresh={fetchDeliveries}
            userRole={userRole}
          />
        )}

        {activeTab === 'notifications' && (
          <NotificationsList
            notifications={notifications}
            loading={loading.notifications}
            error={errors.notifications}
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
            userRole={userRole}
          />
        )}
      </main>

      {/* Create Order Modal */}
      <CreateOrderModal
        isOpen={isCreateOrderOpen}
        onClose={() => setIsCreateOrderOpen(false)}
        selectedProduct={selectedProductForOrder}
        inventory={inventory}
        onSubmitOrder={handleCreateOrderSubmit}
      />

      {/* Global Footer */}
      <footer className="bg-slate-900/60 border-t border-slate-800 py-6 text-center text-xs text-slate-500">
        <p>OmniStore Microservices React Frontend &bull; Target MongoDB Atlas API Gateway: <code className="text-indigo-400">http://localhost:8080</code> &bull; Active Role: <span className="text-indigo-300 font-bold">{userRole}</span></p>
      </footer>
    </div>
  );
}
