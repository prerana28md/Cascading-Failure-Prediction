import React, { useState } from 'react';
import { 
  ShoppingBag, 
  ShoppingCart,
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
  User,
  AlertTriangle,
  ChevronDown,
  ExternalLink,
  LogIn,
  LogOut,
  LayoutDashboard,
  FlaskConical,
  Store
} from 'lucide-react';

export default function Navbar({ 
  activeTab, 
  setActiveTab, 
  gatewayStatus, 
  isMock, 
  userRole, 
  setUserRole,
  servicesHealth = {},
  activeFaults = [],
  cartCount = 0,
  onOpenCart,
  currentUser,
  onOpenAuth,
  onLogout,
  viewMode = 'STOREFRONT', // 'STOREFRONT' | 'OPERATIONS'
  onToggleViewMode
}) {
  const [showHealthMenu, setShowHealthMenu] = useState(false);

  const roles = [
    { id: 'ADMIN', label: 'Admin (Full Access)', icon: ShieldCheck, color: 'text-indigo-400' },
    { id: 'CUSTOMER', label: 'Customer', icon: User, color: 'text-emerald-400' },
    { id: 'INVENTORY_MANAGER', label: 'Inventory Manager', icon: Boxes, color: 'text-amber-400' },
    { id: 'LOGISTICS_AGENT', label: 'Logistics Agent', icon: LogisticsIcon, color: 'text-cyan-400' },
  ];

  // Storefront navigation items
  const storefrontNavItems = [
    { id: 'products', label: 'Storefront', icon: Store },
    { id: 'orders', label: 'My Orders', icon: Package },
    { id: 'order-tracking', label: 'Track Order', icon: Compass },
  ];

  // Operations console navigation items
  const operationsNavItems = [
    { id: 'products', label: 'Catalog', icon: ShoppingBag, roles: ['ADMIN', 'CUSTOMER', 'INVENTORY_MANAGER'] },
    { id: 'orders', label: 'Orders', icon: Package, roles: ['ADMIN', 'CUSTOMER'] },
    { id: 'inventory', label: 'Inventory (:8083)', icon: Boxes, roles: ['ADMIN', 'INVENTORY_MANAGER'] },
    { id: 'payments', label: 'Payments (:8082)', icon: CreditCard, roles: ['ADMIN'] },
    { id: 'shipping', label: 'Shipping (:8084)', icon: Truck, roles: ['ADMIN', 'LOGISTICS_AGENT'] },
    { id: 'delivery', label: 'Delivery (:8085)', icon: MapPin, roles: ['ADMIN', 'LOGISTICS_AGENT'] },
    { id: 'notifications', label: 'Notifications (:8086)', icon: Bell, roles: ['ADMIN'] },
    { id: 'order-tracking', label: 'Order Timeline', icon: Compass, roles: ['ADMIN', 'CUSTOMER', 'LOGISTICS_AGENT'] },
  ];

  const visibleNavItems = viewMode === 'STOREFRONT'
    ? storefrontNavItems
    : operationsNavItems.filter(item => item.roles.includes(userRole));

  const hasFaults = activeFaults.length > 0;

  return (
    <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Top Navbar Row */}
        <div className="flex items-center justify-between h-16 gap-3">
          
          {/* Brand Logo */}
          <div 
            className="flex items-center space-x-3 cursor-pointer shrink-0" 
            onClick={() => setActiveTab('products')}
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-indigo-500/25">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="text-lg font-black bg-gradient-to-r from-white via-slate-200 to-indigo-300 bg-clip-text text-transparent">
                OmniStore
              </span>
              <span className="block text-[10px] font-medium text-slate-400">Microservice Commerce</span>
            </div>
          </div>

          {/* Connected Dashboards Quick-Links (Parts B & C) */}
          <div className="hidden lg:flex items-center space-x-2 bg-slate-950/70 px-2 py-1 rounded-xl border border-slate-800 text-[11px]">
            <span className="text-slate-500 font-semibold px-1">Ecosystem:</span>
            <a
              href="http://localhost:4000"
              target="_blank"
              rel="noreferrer"
              className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-slate-900 text-indigo-300 hover:text-white hover:bg-indigo-600/30 border border-slate-800 transition"
              title="Open Developer Dashboard (Port 4000)"
            >
              <LayoutDashboard className="w-3 h-3 text-indigo-400" />
              <span>Dev Dashboard (:4000)</span>
              <ExternalLink className="w-2.5 h-2.5 opacity-60" />
            </a>

            <a
              href="http://localhost:4001"
              target="_blank"
              rel="noreferrer"
              className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-slate-900 text-amber-300 hover:text-white hover:bg-amber-600/30 border border-slate-800 transition"
              title="Open Fault Injection Lab (Port 4001)"
            >
              <FlaskConical className="w-3 h-3 text-amber-400" />
              <span>Fault Lab (:4001)</span>
              <ExternalLink className="w-2.5 h-2.5 opacity-60" />
            </a>
          </div>

          {/* Right Header Actions */}
          <div className="flex items-center space-x-2.5">
            
            {/* View Mode Toggle: Customer Storefront vs Operations Console */}
            <button
              onClick={onToggleViewMode}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                viewMode === 'STOREFRONT'
                  ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/40 hover:bg-indigo-600/30'
                  : 'bg-cyan-600/20 text-cyan-300 border-cyan-500/40 hover:bg-cyan-600/30'
              }`}
              title="Toggle between Customer Shopping and Operations View"
            >
              {viewMode === 'STOREFRONT' ? (
                <>
                  <Store className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="hidden sm:inline">Customer Store</span>
                </>
              ) : (
                <>
                  <Boxes className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="hidden sm:inline">Operations Console</span>
                </>
              )}
            </button>

            {/* Live Microservices Health Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowHealthMenu(!showHealthMenu)}
                className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-full text-xs font-semibold border transition cursor-pointer ${
                  hasFaults
                    ? 'bg-rose-500/15 text-rose-300 border-rose-500/40 hover:bg-rose-500/25 animate-pulse'
                    : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20'
                }`}
                title="Microservices health via API Gateway"
              >
                <span className={`w-2 h-2 rounded-full ${hasFaults ? 'bg-rose-400' : 'bg-emerald-400'}`} />
                <span className="hidden md:inline">
                  {hasFaults ? `${activeFaults.length} Faulted` : '6/6 Services UP'}
                </span>
                <ChevronDown className="w-3 h-3 ml-0.5 opacity-70" />
              </button>

              {showHealthMenu && (
                <div className="absolute right-0 mt-2 w-72 rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-3 z-50 space-y-2 font-sans">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800 text-xs font-bold text-slate-300">
                    <span>Microservice Health Status</span>
                    <span className="text-[10px] text-slate-400">Via Gateway (:8080)</span>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    {['order', 'payment', 'inventory', 'shipping', 'delivery', 'notification'].map(s => {
                      const sh = servicesHealth[s] || {};
                      const fault = (sh.fault || 'NONE').toUpperCase();
                      const isDown = fault === 'DOWN';
                      const isDegraded = fault === 'ERROR' || fault === 'LATENCY';
                      return (
                        <div key={s} className="flex items-center justify-between p-2 rounded-lg bg-slate-950/70 border border-slate-800/80">
                          <div>
                            <div className="font-semibold text-slate-200 capitalize">{s} Service</div>
                            <div className="text-[10px] text-slate-500">Port :{s === 'order' ? 8081 : s === 'payment' ? 8082 : s === 'inventory' ? 8083 : s === 'shipping' ? 8084 : s === 'delivery' ? 8085 : 8086}</div>
                          </div>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            isDown 
                              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40' 
                              : isDegraded 
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' 
                              : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                          }`}>
                            {fault !== 'NONE' ? fault : 'UP'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Shopping Cart Button */}
            <button
              onClick={onOpenCart}
              className="relative p-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-200 transition cursor-pointer"
              title="Open Shopping Cart"
            >
              <ShoppingCart className="w-4 h-4 text-indigo-400" />
              {cartCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-indigo-600 text-white font-extrabold text-[10px] flex items-center justify-center shadow-md animate-in zoom-in-50 duration-200">
                  {cartCount}
                </span>
              )}
            </button>

            {/* Customer Authentication Profile / Login Button */}
            {currentUser ? (
              <div className="flex items-center space-x-2 bg-slate-950/80 px-2.5 py-1 rounded-xl border border-slate-800 text-xs">
                <div className="w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center text-[10px] font-bold text-white uppercase">
                  {currentUser.username?.[0] || 'U'}
                </div>
                <div className="hidden sm:block text-left">
                  <span className="block font-semibold text-slate-200 leading-none">
                    {currentUser.username}
                  </span>
                  <span className="text-[9px] text-indigo-400 font-mono">
                    {currentUser.role || 'USER'}
                  </span>
                </div>
                <button
                  onClick={onLogout}
                  className="p-1 text-slate-400 hover:text-rose-400 transition"
                  title="Sign Out"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={onOpenAuth}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Sign In</span>
              </button>
            )}

            {/* Role Selector (visible in Operations Console mode) */}
            {viewMode === 'OPERATIONS' && (
              <div className="hidden sm:flex items-center space-x-1.5 bg-slate-950 px-2.5 py-1.5 rounded-xl border border-slate-800 text-xs">
                <UserCheck className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <select
                  value={userRole}
                  onChange={(e) => setUserRole(e.target.value)}
                  className="bg-transparent text-indigo-300 font-bold focus:outline-none cursor-pointer text-xs"
                >
                  {roles.map(r => (
                    <option key={r.id} value={r.id} className="bg-slate-900 text-slate-200 font-sans">
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

          </div>
        </div>

        {/* Navigation Tabs Bar */}
        <nav className="flex space-x-1 overflow-x-auto py-2 scrollbar-none border-t border-slate-800/60">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition cursor-pointer ${
                  isActive
                    ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-indigo-400' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
