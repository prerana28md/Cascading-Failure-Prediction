import React, { useState } from 'react';
import { 
  ShoppingCart, 
  X, 
  Trash2, 
  Plus, 
  Minus, 
  ArrowRight, 
  ShieldCheck, 
  Tag, 
  AlertTriangle,
  ShoppingBag
} from 'lucide-react';

export default function CartDrawer({
  isOpen,
  onClose,
  cartItems = [],
  onUpdateQuantity,
  onRemoveItem,
  onClearCart,
  onOpenCheckout,
  servicesHealth = {}
}) {
  const [promoCode, setPromoCode] = useState('');
  const [discountPercent, setDiscountPercent] = useState(0);
  const [promoMessage, setPromoMessage] = useState(null);

  if (!isOpen) return null;

  // Price calculations
  const subtotal = cartItems.reduce((sum, item) => {
    const price = Number(item.product?.price || 0);
    return sum + price * item.quantity;
  }, 0);

  const shipping = subtotal > 150 || subtotal === 0 ? 0 : 15.00;
  const discountAmount = (subtotal * discountPercent) / 100;
  const tax = ((subtotal - discountAmount) * 0.08);
  const finalTax = tax > 0 ? tax : 0;
  const total = Math.max(0, subtotal - discountAmount + shipping + finalTax);

  const handleApplyPromo = (e) => {
    e.preventDefault();
    const code = promoCode.trim().toUpperCase();
    if (code === 'SAVE10' || code === 'OMNI10') {
      setDiscountPercent(10);
      setPromoMessage({ success: true, text: '10% discount applied!' });
    } else if (code === 'RESEARCH' || code === 'CASCADE20') {
      setDiscountPercent(20);
      setPromoMessage({ success: true, text: '20% Research Partner discount applied!' });
    } else {
      setPromoMessage({ success: false, text: 'Invalid promo code. Try SAVE10' });
    }
  };

  const paymentFault = servicesHealth?.payment?.fault && servicesHealth.payment.fault !== 'NONE' 
    ? servicesHealth.payment.fault : null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden animate-in fade-in duration-200">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col">
          
          {/* Drawer Header */}
          <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
                <ShoppingCart className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  Shopping Cart
                  <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-semibold">
                    {cartItems.reduce((acc, item) => acc + item.quantity, 0)} items
                  </span>
                </h2>
                <p className="text-xs text-slate-400">Review selected items before checkout</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              aria-label="Close cart"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Microservice Fault Warning in Cart */}
          {paymentFault && (
            <div className="bg-amber-950/80 border-b border-amber-800/80 px-4 py-2.5 text-xs text-amber-200 flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span>
                <strong>Warning:</strong> Payment Service has an active fault ({paymentFault}). Transactions during checkout may fail.
              </span>
            </div>
          )}

          {/* Cart Items List */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {cartItems.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-4 py-12">
                <div className="w-16 h-16 rounded-2xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-center text-slate-500">
                  <ShoppingBag className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Your cart is empty</h3>
                  <p className="text-xs text-slate-400 mt-1 max-w-xs">
                    Explore our electronics catalog to add items to your cart.
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition"
                >
                  Browse Products
                </button>
              </div>
            ) : (
              cartItems.map((item) => {
                const itemPrice = Number(item.product?.price || 0);
                const itemTotal = (itemPrice * item.quantity).toFixed(2);
                return (
                  <div
                    key={item.product?.productId || item.product?.id}
                    className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-slate-700 flex flex-col gap-3 transition"
                  >
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1 pr-2">
                        <span className="text-[10px] font-mono text-indigo-400 uppercase tracking-wider">
                          SKU: PRD-{item.product?.productId || item.product?.id}
                        </span>
                        <h4 className="text-sm font-semibold text-white truncate">
                          {item.product?.productName}
                        </h4>
                        <span className="text-xs text-slate-400 font-mono">
                          ${itemPrice.toFixed(2)} each
                        </span>
                      </div>
                      <button
                        onClick={() => onRemoveItem(item.product?.productId || item.product?.id)}
                        className="text-slate-500 hover:text-rose-400 transition p-1"
                        title="Remove item"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                      {/* Quantity Selector */}
                      <div className="flex items-center space-x-2 bg-slate-900 border border-slate-800 rounded-lg p-1">
                        <button
                          onClick={() => onUpdateQuantity(item.product?.productId || item.product?.id, Math.max(1, item.quantity - 1))}
                          disabled={item.quantity <= 1}
                          className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-xs font-bold text-white px-2 min-w-[20px] text-center font-mono">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => onUpdateQuantity(item.product?.productId || item.product?.id, item.quantity + 1)}
                          className="p-1 rounded text-slate-400 hover:text-white"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>

                      {/* Line Item Total */}
                      <span className="text-sm font-black text-indigo-300 font-mono">
                        ${itemTotal}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Drawer Footer & Checkout Action */}
          {cartItems.length > 0 && (
            <div className="p-6 border-t border-slate-800 bg-slate-950/80 space-y-4">
              {/* Promo Code Form */}
              <form onSubmit={handleApplyPromo} className="flex gap-2">
                <div className="relative flex-1">
                  <Tag className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Promo code (SAVE10)"
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 uppercase focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
                >
                  Apply
                </button>
              </form>

              {promoMessage && (
                <p className={`text-[11px] ${promoMessage.success ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {promoMessage.text}
                </p>
              )}

              {/* Cost Breakdown */}
              <div className="space-y-1.5 text-xs text-slate-400 border-t border-slate-800/80 pt-3">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span className="font-mono text-slate-200">${subtotal.toFixed(2)}</span>
                </div>
                {discountAmount > 0 && (
                  <div className="flex justify-between text-emerald-400">
                    <span>Discount ({discountPercent}%)</span>
                    <span className="font-mono">-${discountAmount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Shipping</span>
                  <span className="font-mono text-slate-200">
                    {shipping === 0 ? <span className="text-emerald-400 font-semibold">FREE</span> : `$${shipping.toFixed(2)}`}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Estimated Tax (8%)</span>
                  <span className="font-mono text-slate-200">${finalTax.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm font-extrabold text-white pt-2 border-t border-slate-800">
                  <span>Total</span>
                  <span className="font-mono text-indigo-400 text-base font-black">
                    ${total.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Checkout & Clear Buttons */}
              <div className="space-y-2 pt-2">
                <button
                  onClick={() => {
                    onClose();
                    onOpenCheckout({
                      cartItems,
                      subtotal,
                      shipping,
                      discountAmount,
                      tax: finalTax,
                      total
                    });
                  }}
                  className="w-full flex items-center justify-center space-x-2 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition cursor-pointer"
                >
                  <span>Proceed to Checkout</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <button
                  onClick={onClearCart}
                  className="w-full text-center text-[11px] text-slate-500 hover:text-rose-400 transition py-1"
                >
                  Clear Cart
                </button>
              </div>

              <div className="flex items-center justify-center space-x-1.5 text-[10px] text-slate-500">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Protected by Microservice Circuit Breaker & Fallback Security</span>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
