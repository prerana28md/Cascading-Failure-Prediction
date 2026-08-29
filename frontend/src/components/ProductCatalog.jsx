import React, { useState } from 'react';
import { ShoppingBag, Search, Tag, CheckCircle2, AlertCircle, Plus, RefreshCw } from 'lucide-react';

export default function ProductCatalog({ inventory, loading, error, onRefresh, onOrderProduct, onOpenAddProduct }) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredItems = (inventory || []).filter(item => 
    (item.productName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    String(item.productId || '').includes(searchTerm)
  );

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 p-6 sm:p-8">
        <div className="relative z-10 max-w-2xl space-y-3">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-xs font-semibold">
            <ShoppingBag className="w-3.5 h-3.5" />
            <span>Inventory Product Catalog</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Discover & Place Microservice Orders
          </h1>
          <p className="text-slate-400 text-sm">
            Browse live stock maintained by the Inventory Microservice. Trigger seamless order creation flowing across Order, Payment, Shipping, and Delivery services.
          </p>
        </div>
      </div>

      {/* Filter and Action Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search product name or ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center space-x-3 w-full sm:w-auto justify-end">
          <button
            onClick={onRefresh}
            className="flex items-center space-x-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          
          <button
            onClick={onOpenAddProduct}
            className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition"
          >
            <Plus className="w-4 h-4" />
            <span>Add Product</span>
          </button>
        </div>
      </div>

      {/* Loading & Error States */}
      {loading && (
        <div className="flex items-center justify-center py-12 text-slate-400 space-x-3">
          <RefreshCw className="w-5 h-5 animate-spin text-indigo-400" />
          <span className="text-sm font-medium">Fetching live product inventory...</span>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center space-x-3">
          <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
          <span>Error loading inventory: {error}. Showing available mock catalog.</span>
        </div>
      )}

      {/* Product Cards Grid */}
      {!loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredItems.map((product) => {
            const isOutOfStock = (product.quantity || 0) <= 0;
            return (
              <div
                key={product.id || product.productId}
                className="group rounded-2xl bg-slate-900/80 border border-slate-800/80 hover:border-indigo-500/50 p-5 transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-indigo-500/10 flex flex-col justify-between"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[11px]">
                      <Tag className="w-3 h-3 mr-1 text-indigo-400" />
                      ID: {product.productId}
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
                          {product.quantity} units available
                        </>
                      )}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-base font-bold text-white group-hover:text-indigo-300 transition">
                      {product.productName || 'Unnamed Product'}
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Managed via Inventory Microservice
                    </p>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-slate-500 block">Unit Price</span>
                    <span className="text-lg font-extrabold text-indigo-300 font-mono">
                      ${Number(product.price || 0).toFixed(2)}
                    </span>
                  </div>

                  <button
                    disabled={isOutOfStock}
                    onClick={() => onOrderProduct(product)}
                    className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
                      isOutOfStock
                        ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                        : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30'
                    }`}
                  >
                    <ShoppingBag className="w-3.5 h-3.5" />
                    <span>Order Now</span>
                  </button>
                </div>
              </div>
            );
          })}

          {filteredItems.length === 0 && !loading && (
            <div className="col-span-full py-12 text-center text-slate-500 text-xs">
              No products found matching "{searchTerm}". Try adding a new product item!
            </div>
          )}
        </div>
      )}
    </div>
  );
}
