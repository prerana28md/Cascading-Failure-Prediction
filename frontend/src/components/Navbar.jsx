import React, { useState } from 'react';
import { 
  ShoppingCart,
  Package, 
  Activity, 
  Compass,
  LogIn,
  LogOut,
  Store
} from 'lucide-react';

export default function Navbar({ 
  activeTab, 
  setActiveTab, 
  cartCount = 0,
  onOpenCart,
  currentUser,
  onOpenAuth,
  onLogout
}) {
  const navItems = [
    { id: 'products', label: 'Storefront', icon: Store },
    { id: 'orders', label: 'My Orders', icon: Package },
    { id: 'order-tracking', label: 'Track Order', icon: Compass },
  ];

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
              <span className="block text-[10px] font-medium text-slate-400">Online Store</span>
            </div>
          </div>

          {/* Right Header Actions */}
          <div className="flex items-center space-x-2.5">

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

          </div>
        </div>

        {/* Navigation Tabs Bar */}
        <nav className="flex space-x-1 overflow-x-auto py-2 scrollbar-none border-t border-slate-800/60">
          {navItems.map((item) => {
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
