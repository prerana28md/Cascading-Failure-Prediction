import React from 'react';
import { 
  ShoppingBag, 
  PlusCircle, 
  Package, 
  Boxes, 
  CreditCard, 
  Truck, 
  MapPin, 
  Bell, 
  Activity, 
  Server,
  Compass,
  UserCheck,
  ShieldAlert,
  ShieldCheck,
  Truck as LogisticsIcon,
  User
} from 'lucide-react';

export default function Navbar({ activeTab, setActiveTab, gatewayStatus, isMock, userRole, setUserRole }) {
  const roles = [
    { id: 'ADMIN', label: 'Admin (Full Access)', icon: ShieldCheck, color: 'text-indigo-400' },
    { id: 'CUSTOMER', label: 'Customer', icon: User, color: 'text-emerald-400' },
    { id: 'INVENTORY_MANAGER', label: 'Inventory Manager', icon: Boxes, color: 'text-amber-400' },
    { id: 'LOGISTICS_AGENT', label: 'Logistics Agent', icon: LogisticsIcon, color: 'text-cyan-400' },
  ];

  const allNavItems = [
    { id: 'products', label: 'Home / Products', icon: ShoppingBag, roles: ['ADMIN', 'CUSTOMER', 'INVENTORY_MANAGER'] },
    { id: 'create-order', label: 'Create Order', icon: PlusCircle, roles: ['ADMIN', 'CUSTOMER'] },
    { id: 'orders', label: 'Orders', icon: Package, roles: ['ADMIN', 'CUSTOMER'] },
    { id: 'inventory', label: 'Inventory', icon: Boxes, roles: ['ADMIN', 'INVENTORY_MANAGER'] },
    { id: 'payments', label: 'Payments', icon: CreditCard, roles: ['ADMIN'] },
    { id: 'shipping', label: 'Shipping', icon: Truck, roles: ['ADMIN', 'LOGISTICS_AGENT'] },
    { id: 'delivery', label: 'Delivery', icon: MapPin, roles: ['ADMIN', 'LOGISTICS_AGENT'] },
    { id: 'notifications', label: 'Notifications', icon: Bell, roles: ['ADMIN'] },
    { id: 'order-tracking', label: 'Order Tracking', icon: Compass, roles: ['ADMIN', 'CUSTOMER', 'LOGISTICS_AGENT'] },
  ];

  const visibleNavItems = allNavItems.filter(item => item.roles.includes(userRole));

  return (
    <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand Logo */}
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setActiveTab('products')}>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-indigo-500/25">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <div>
              <span className="text-lg font-bold bg-gradient-to-r from-white via-slate-200 to-indigo-300 bg-clip-text text-transparent">
                OmniStore
              </span>
              <span className="block text-xs font-medium text-slate-400">Microservice Commerce</span>
            </div>
          </div>

          {/* Backend Connection Indicator & Role Switcher */}
          <div className="flex items-center space-x-4">
            <div className="hidden lg:flex items-center space-x-3 bg-slate-950/60 px-3 py-1.5 rounded-full border border-slate-800 text-xs">
              <Server className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-slate-400">Gateway:</span>
              <span className="font-mono text-slate-200">http://localhost:8080</span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                gatewayStatus === 'UP' 
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' 
                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${gatewayStatus === 'UP' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
                {gatewayStatus === 'UP' ? 'LIVE ATLAS' : isMock ? 'OFFLINE (MOCK)' : 'CONNECTING'}
              </span>
            </div>

            {/* Interactive Role Selector Dropdown */}
            <div className="flex items-center space-x-2 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-xs">
              <UserCheck className="w-4 h-4 text-indigo-400 flex-shrink-0" />
              <span className="text-slate-400 hidden sm:inline">Role:</span>
              <select
                value={userRole}
                onChange={(e) => setUserRole(e.target.value)}
                className="bg-transparent text-indigo-300 font-bold focus:outline-none cursor-pointer"
              >
                {roles.map(r => (
                  <option key={r.id} value={r.id} className="bg-slate-900 text-slate-200 font-sans">
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Primary Quick Actions */}
            {(userRole === 'ADMIN' || userRole === 'CUSTOMER') && (
              <button
                onClick={() => setActiveTab('create-order')}
                className="flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-all shadow-md shadow-indigo-600/30"
              >
                <PlusCircle className="w-4 h-4" />
                <span className="hidden sm:inline">New Order</span>
              </button>
            )}
          </div>
        </div>

        {/* Navigation Tabs (Role Filtered) */}
        <nav className="flex space-x-1 overflow-x-auto py-2 scrollbar-none border-t border-slate-800/60">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-400' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
