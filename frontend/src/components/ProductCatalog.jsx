import React, { useState } from 'react';
import { 
  ShoppingBag, 
  Search, 
  Tag, 
  CheckCircle2, 
  AlertCircle, 
  Plus, 
  Minus,
  RefreshCw, 
  ShoppingCart,
  Star,
  Zap,
  ShieldCheck,
  Headphones,
  Monitor,
  Keyboard,
  Cpu,
  Mouse
} from 'lucide-react';

export default function ProductCatalog({ 
  inventory = [], 
  loading, 
  error, 
  serviceHealth, 
  onRefresh, 
  onAddToCart,
  onBuyNow,
  onOrderProduct, 
  onOpenAddProduct,
  userRole
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [quantities, setQuantities] = useState({});
  const [addedItemNotice, setAddedItemNotice] = useState(null);

  const isFaulted = serviceHealth?.fault && serviceHealth.fault !== 'NONE';
  const faultType = serviceHealth?.fault;
  const isAuthRequired = Boolean(error && (error.includes('403') || error.includes('401') || error.includes('Authentication')));
  const isOutage = isFaulted || (error && !isAuthRequired);

  // Categories
  const categories = [
    { id: 'ALL', label: 'All Products' },
    { id: 'AUDIO', label: 'Audio & Sound' },
    { id: 'DISPLAYS', label: 'Monitors & Displays' },
    { id: 'PERIPHERALS', label: 'Keyboards & Mice' },
    { id: 'ACCESSORIES', label: 'Hubs & Accessories' },
  ];

  const getCategory = (productName = '') => {
    const name = productName.toLowerCase();
    if (name.includes('headphone') || name.includes('audio') || name.includes('sound')) return 'AUDIO';
    if (name.includes('monitor') || name.includes('screen') || name.includes('display')) return 'DISPLAYS';
    if (name.includes('keyboard') || name.includes('mouse')) return 'PERIPHERALS';
    return 'ACCESSORIES';
  };

  const getProductIcon = (productName = '') => {
    const cat = getCategory(productName);
    if (cat === 'AUDIO') return Headphones;
    if (cat === 'DISPLAYS') return Monitor;
    if (cat === 'PERIPHERALS') return (productName.toLowerCase().includes('mouse') ? Mouse : Keyboard);
    return Cpu;
  };

  const getQuantityFor = (id) => quantities[id] || 1;
  const setQuantityFor = (id, delta) => {
    setQuantities(prev => ({
      ...prev,
      [id]: Math.max(1, (prev[id] || 1) + delta)
    }));
  };

  const handleAdd = (product) => {
    const qty = getQuantityFor(product.productId || product.id);
    if (onAddToCart) {
      onAddToCart(product, qty);
    } else if (onOrderProduct) {
      onOrderProduct(product);
    }
    setAddedItemNotice(product.productName);
    setTimeout(() => setAddedItemNotice(null), 2500);
  };

  const handleBuy = (product) => {
    const qty = getQuantityFor(product.productId || product.id);
    if (onBuyNow) {
      onBuyNow(product, qty);
    } else if (onOrderProduct) {
      onOrderProduct(product);
    }
  };

  const filteredItems = (inventory || []).filter(item => {
    const matchesSearch = (item.productName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      String(item.productId || '').includes(searchTerm);
    if (!matchesSearch) return false;
    if (selectedCategory === 'ALL') return true;
    return getCategory(item.productName) === selectedCategory;
  });

  return (
    <div className="space-y-6 font-sans">
      
      {/* Hero Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950/60 to-slate-900 border border-slate-800 p-6 sm:p-8">
        <div className="relative z-10 max-w-2xl space-y-3">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-xs font-semibold">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>OmniStore Flagship Tech &bull; Live Microservices</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
            High-Performance Hardware &bull; Resilient Commerce
          </h1>
          <p className="text-slate-300 text-sm leading-relaxed">
            Browse our real-time product inventory served by the Inventory Microservice (:8083). Add products to your cart and trigger genuine transactional flows across Order, Payment, Shipping, and Delivery services.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2 text-xs text-slate-400">
            <span className="flex items-center gap-1.5 bg-slate-900/80 px-2.5 py-1 rounded-lg border border-slate-800">
              <ShieldCheck className="w-4 h-4 text-emerald-400" /> Real MongoDB Stock
            </span>
            <span className="flex items-center gap-1.5 bg-slate-900/80 px-2.5 py-1 rounded-lg border border-slate-800">
              <CheckCircle2 className="w-4 h-4 text-indigo-400" /> Multi-Step Transaction Pipeline
            </span>
          </div>
        </div>
      </div>

      {/* Outage / Fault Notice */}
      {isOutage && (
        <div className="p-5 rounded-2xl bg-rose-950/80 border border-rose-800/80 text-rose-200 text-xs space-y-2 shadow-lg animate-in fade-in duration-200">
          <div className="flex items-center space-x-2 font-bold text-sm text-rose-300">
            <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
            <span>Inventory Microservice Outage Detected</span>
            {faultType && (
              <span className="px-2 py-0.5 rounded bg-rose-900 border border-rose-700 text-[10px] font-extrabold uppercase">
                {faultType}
              </span>
            )}
          </div>
          <p className="text-slate-300">
            {error || `Inventory Service (:8083) is experiencing a ${faultType} fault. Live catalogue stock queries and inventory reserves are failing.`}
          </p>
        </div>
      )}

      {/* Auth Notice */}
      {isAuthRequired && !isFaulted && (
        <div className="p-4 rounded-2xl bg-indigo-950/70 border border-indigo-800/80 text-indigo-200 text-xs flex flex-col sm:flex-row items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center space-x-2">
            <ShieldCheck className="w-5 h-5 text-indigo-400 flex-shrink-0" />
            <span>Connecting session to microservice inventory...</span>
          </div>
          <button
            onClick={onRefresh}
            className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition"
          >
            Load Catalog
          </button>
        </div>
      )}

      {/* Added to Cart Feedback Toast */}
      {addedItemNotice && (
        <div className="fixed bottom-6 right-6 z-50 p-4 rounded-xl bg-indigo-600 text-white shadow-2xl flex items-center space-x-3 text-xs font-semibold animate-in slide-in-from-bottom duration-200">
          <ShoppingCart className="w-4 h-4" />
          <span>Added "{addedItemNotice}" to shopping cart!</span>
        </div>
      )}

      {/* Filter and Action Bar */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search product name or SKU..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex items-center space-x-3 w-full sm:w-auto justify-end">
            <button
              onClick={onRefresh}
              className="flex items-center space-x-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh Stock</span>
            </button>
            
            {userRole === 'ADMIN' && (
              <button
                onClick={onOpenAddProduct}
                className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Add Product</span>
              </button>
            )}
          </div>
        </div>

        {/* Category Pills */}
        <div className="flex space-x-2 overflow-x-auto pb-1 scrollbar-none">
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition cursor-pointer ${
                selectedCategory === cat.id
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 border border-slate-800 hover:bg-slate-800'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-slate-400 space-x-3">
          <RefreshCw className="w-6 h-6 animate-spin text-indigo-400" />
          <span className="text-sm font-medium">Querying Inventory Microservice (:8083)...</span>
        </div>
      )}

      {/* Product Cards Grid */}
      {!loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredItems.map((product) => {
            const isOutOfStock = (product.quantity || 0) <= 0;
            const pId = product.productId || product.id;
            const IconComponent = getProductIcon(product.productName);
            const qty = getQuantityFor(pId);

            return (
              <div
                key={pId}
                className="group rounded-2xl bg-slate-900/80 border border-slate-800/80 hover:border-indigo-500/50 p-5 transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-indigo-500/10 flex flex-col justify-between"
              >
                <div className="space-y-4">
                  {/* Top Bar: SKU + Stock Status */}
                  <div className="flex items-start justify-between">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[11px]">
                      <Tag className="w-3 h-3 mr-1 text-indigo-400" />
                      SKU: PRD-{pId}
                    </span>
                    
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold ${
                      isOutOfStock
                        ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                        : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                    }`}>
                      {isOutOfStock ? (
                        <>
                          <AlertCircle className="w-3 h-3 mr-1" />
                          Out of Stock
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          {product.quantity} in stock
                        </>
                      )}
                    </span>
                  </div>

                  {/* Product Icon & Name */}
                  <div className="flex items-start space-x-3.5 pt-1">
                    <div className="w-12 h-12 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center text-indigo-400 shrink-0 group-hover:scale-105 group-hover:border-indigo-500/40 transition">
                      <IconComponent className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white group-hover:text-indigo-300 transition line-clamp-1">
                        {product.productName}
                      </h3>
                      <div className="flex items-center space-x-1.5 mt-1">
                        <div className="flex text-amber-400">
                          {[...Array(5)].map((_, i) => (
                            <Star key={i} className="w-3 h-3 fill-current" />
                          ))}
                        </div>
                        <span className="text-[11px] text-slate-400">(4.8 &bull; 120+ reviews)</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Price & Quantity & Actions */}
                <div className="mt-5 pt-4 border-t border-slate-800/80 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="block text-[10px] text-slate-400">Unit Price</span>
                      <span className="text-xl font-black text-indigo-300 font-mono">
                        ${Number(product.price || 0).toFixed(2)}
                      </span>
                    </div>

                    {/* Quantity Selector */}
                    {!isOutOfStock && (
                      <div className="flex items-center space-x-1.5 bg-slate-950 border border-slate-800 rounded-lg p-1">
                        <button
                          onClick={() => setQuantityFor(pId, -1)}
                          disabled={qty <= 1}
                          className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-30"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-xs font-bold text-white px-2 font-mono">{qty}</span>
                        <button
                          onClick={() => setQuantityFor(pId, 1)}
                          disabled={qty >= (product.quantity || 99)}
                          className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-30"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      onClick={() => handleAdd(product)}
                      disabled={isOutOfStock}
                      className="flex items-center justify-center space-x-1.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs font-semibold border border-slate-700 hover:border-slate-600 transition cursor-pointer"
                    >
                      <ShoppingCart className="w-3.5 h-3.5" />
                      <span>Add to Cart</span>
                    </button>

                    <button
                      onClick={() => handleBuy(product)}
                      disabled={isOutOfStock}
                      className="flex items-center justify-center space-x-1.5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 text-white text-xs font-bold shadow-md shadow-indigo-600/20 transition cursor-pointer"
                    >
                      <ShoppingBag className="w-3.5 h-3.5" />
                      <span>Buy Now</span>
                    </button>
                  </div>
                </div>

              </div>
            );
          })}

          {filteredItems.length === 0 && (
            <div className="col-span-full py-16 text-center text-slate-500 font-sans">
              {isFaulted || error ? (
                <div className="space-y-1">
                  <p className="text-rose-300 font-semibold text-base">Inventory catalog unavailable</p>
                  <p className="text-xs text-slate-500">Service is down or unreachable. Products will load once inventory-service recovers.</p>
                </div>
              ) : (
                <span>No products found matching your search.</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
