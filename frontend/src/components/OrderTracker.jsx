import React, { useState } from 'react';
import { 
  Compass, 
  Search, 
  CheckCircle2, 
  Clock, 
  Package, 
  Boxes, 
  CreditCard, 
  Truck, 
  MapPin, 
  Bell, 
  XCircle
} from 'lucide-react';

export default function OrderTracker({ 
  orders, 
  selectedOrder, 
  payments, 
  shipments, 
  deliveries, 
  notifications
}) {
  const [selectedOrderId, setSelectedOrderId] = useState(
    selectedOrder ? selectedOrder.id : (orders && orders.length > 0 ? orders[0].id : '')
  );

  const activeOrder = orders?.find(o => String(o.id) === String(selectedOrderId)) || selectedOrder || (orders && orders[0]);

  // Find related entity records across services
  const relatedPayment = payments?.find(p => String(p.orderId) === String(activeOrder?.id));
  const relatedShipment = shipments?.find(s => String(s.orderId) === String(activeOrder?.id));
  const relatedDelivery = deliveries?.find(d => String(d.shipmentId) === String(relatedShipment?.id));
  const relatedNotifs = notifications?.filter(n => (n.message || '').includes(String(activeOrder?.id)));

  const orderFailed = ['FAILED', 'PAYMENT_FAILED'].includes((activeOrder?.status || '').toUpperCase());
  const paymentFailed = (activeOrder?.status || '').toUpperCase() === 'PAYMENT_FAILED';

  const stages = [
    {
      id: 'order',
      title: 'Order Created',
      icon: Package,
      status: orderFailed ? 'FAILED' : activeOrder ? 'COMPLETED' : 'PENDING',
      details: orderFailed
        ? (activeOrder?.statusReason || 'We could not place this order.')
        : activeOrder 
        ? `Order #${activeOrder.id} placed · ${activeOrder.quantity} item(s)`
        : 'Waiting for order creation',
      timestamp: activeOrder?.createdAt ? new Date(activeOrder.createdAt).toLocaleString() : 'Done'
    },
    {
      id: 'inventory',
      title: 'Stock Deducted',
      icon: Boxes,
      status: activeOrder ? 'COMPLETED' : 'PENDING',
      details: activeOrder
        ? `Items prepared for your order (${activeOrder.quantity} item(s))`
        : 'Stock deduction pending',
      timestamp: activeOrder?.createdAt ? new Date(activeOrder.createdAt).toLocaleString() : 'Done'
    },
    {
      id: 'payment',
      title: 'Payment Processed',
      icon: CreditCard,
      status: paymentFailed 
        ? 'FAILED' 
        : relatedPayment 
        ? (relatedPayment.status || 'SUCCESS') 
        : activeOrder
        ? 'COMPLETED' 
        : 'PENDING',
      details: paymentFailed 
        ? (activeOrder?.statusReason || 'Payment failed: Payment Service is currently DOWN or transaction was rejected.') 
        : relatedPayment 
        ? `Payment Pay-#${relatedPayment.id} confirmed: $${Number(relatedPayment.amount).toFixed(2)}` 
        : activeOrder 
        ? `Payment processed for $${Number(activeOrder.amount).toFixed(2)}` 
        : 'Payment pending',
      timestamp: relatedPayment?.transactionDate ? new Date(relatedPayment.transactionDate).toLocaleString() : 'Done'
    },
    {
      id: 'shipping',
      title: 'Shipment Created',
      icon: Truck,
      status: paymentFailed ? 'PENDING' : relatedShipment ? 'COMPLETED' : activeOrder ? 'COMPLETED' : 'PENDING',
      details: paymentFailed 
        ? 'Shipping will begin once payment is complete.'
        : relatedShipment 
        ? `Shipment Ship-#${relatedShipment.id} created to ${relatedShipment.address}` 
        : activeOrder 
        ? `Shipment dispatch created for Order #${activeOrder.id}` 
        : 'Shipment pending',
      timestamp: relatedShipment?.shippedDate ? new Date(relatedShipment.shippedDate).toLocaleString() : 'Done'
    },
    {
      id: 'delivery',
      title: 'Out for Delivery',
      icon: MapPin,
      status: paymentFailed ? 'PENDING' : relatedDelivery ? (relatedDelivery.status === 'DELIVERED' ? 'COMPLETED' : 'IN_PROGRESS') : activeOrder ? 'IN_PROGRESS' : 'PENDING',
      details: paymentFailed 
        ? 'Delivery will be scheduled after payment is complete.'
        : relatedDelivery 
        ? `Delivery Deliv-#${relatedDelivery.id}: ${relatedDelivery.status} (${relatedDelivery.estimatedDelivery})` 
        : activeOrder 
        ? 'Delivery assigned, estimated 3-5 business days' 
        : 'Delivery pending',
      timestamp: relatedDelivery ? 'In Transit' : 'Pending'
    },
    {
      id: 'notification',
      title: 'Notification Sent',
      icon: Bell,
      status: (relatedNotifs && relatedNotifs.length > 0) || activeOrder ? 'COMPLETED' : 'PENDING',
      details: (relatedNotifs && relatedNotifs.length > 0)
        ? 'We sent an update about your order.'
        : activeOrder 
        ? 'We will keep you updated as your order progresses.'
        : 'Notification pending',
      timestamp: relatedNotifs && relatedNotifs[0]?.timestamp ? new Date(relatedNotifs[0].timestamp).toLocaleTimeString() : 'Sent'
    }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-900/80 p-6 rounded-2xl border border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2 text-indigo-400 text-xs font-semibold">
              <Compass className="w-4 h-4" />
              <span>Order updates</span>
            </div>
            <h2 className="text-xl font-bold text-white">Track your order</h2>
            <p className="text-slate-400 text-xs">
              Follow your purchase from checkout through delivery.
            </p>
          </div>

          {/* Order Selector */}
          <div className="flex items-center space-x-2">
            <span className="text-xs text-slate-400 font-medium">Select Order:</span>
            <select
              value={selectedOrderId}
              onChange={(e) => setSelectedOrderId(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-indigo-300 font-mono focus:outline-none focus:border-indigo-500"
            >
              {orders?.map(o => (
                <option key={o.id} value={o.id}>
                  Order #{o.id} — {o.status} (${Number(o.amount || 0).toFixed(2)})
                </option>
              ))}
              {!orders?.length && (
                <option value="">No Orders Available</option>
              )}
            </select>
          </div>
        </div>

        {activeOrder && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs">
            <div>
              <span className="text-slate-500 block">Tracking Order</span>
              <span className="font-mono font-bold text-indigo-300 text-sm">#{activeOrder.id}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Total Amount</span>
              <span className="font-mono font-bold text-emerald-400">${Number(activeOrder.amount).toFixed(2)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Lifecycle Timeline */}
      <div className="p-6 sm:p-8 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-8">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider text-slate-400">
          Order progress
        </h3>

        <div className="relative">
          {/* Vertical Connecting Line */}
          <div className="absolute left-6 top-6 bottom-6 w-0.5 bg-slate-800 z-0 hidden sm:block"></div>

          <div className="space-y-6 relative z-10">
            {stages.map((stage, idx) => {
              const Icon = stage.icon;
              const isCompleted = stage.status === 'COMPLETED' || stage.status === 'SUCCESS';
              const isInProgress = stage.status === 'IN_PROGRESS';
              const isFailed = stage.status === 'FAILED';

              return (
                <div key={stage.id} className="flex flex-col sm:flex-row items-start sm:items-center space-y-3 sm:space-y-0 sm:space-x-6 group">
                  {/* Step Badge */}
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all ${
                    isFailed
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 shadow-lg shadow-rose-500/10'
                      : isCompleted 
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-lg shadow-emerald-500/10'
                      : isInProgress
                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30 animate-pulse'
                      : 'bg-slate-950 text-slate-600 border border-slate-800'
                  }`}>
                    <Icon className="w-6 h-6" />
                  </div>

                  {/* Stage Details Box */}
                  <div className={`flex-1 w-full p-4 rounded-xl border transition ${
                    isFailed
                      ? 'bg-rose-950/40 border-rose-800/80'
                      : 'bg-slate-950/60 border-slate-800/80 hover:border-indigo-500/40'
                  }`}>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                      <div className="flex items-center space-x-2">
                        <h4 className={`text-sm font-bold ${isFailed ? 'text-rose-200' : 'text-white'}`}>
                          {idx + 1}. {stage.title}
                        </h4>
                      </div>

                      <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        isFailed
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                          : isCompleted
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : isInProgress
                          ? 'bg-amber-500/10 text-amber-400'
                          : 'bg-slate-800 text-slate-500'
                      }`}>
                        {isFailed ? (
                          <>
                            <XCircle className="w-3 h-3 mr-1" />
                            FAILED
                          </>
                        ) : isCompleted ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            COMPLETED
                          </>
                        ) : (
                          <>
                            <Clock className="w-3 h-3 mr-1" />
                            {stage.status}
                          </>
                        )}
                      </span>
                    </div>

                    <p className={`text-xs mt-1.5 leading-relaxed font-sans ${isFailed ? 'text-rose-300 font-medium' : 'text-slate-400'}`}>
                      {stage.details}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
