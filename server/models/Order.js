import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const orderItemSchema = new Schema({
  productId: { type: String, required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  quantity: { type: Number, required: true, default: 1 },
  image: String
}, { _id: false }); // Disable automatic _id generation for subdocuments

const paymentDetailsSchema = new Schema({
  gateway: { type: String, required: true }, // 'phonepe', 'razorpay', etc.
  transactionId: { type: String }, // Make this optional initially, will be set after PhonePe response
  gatewayTransactionId: String,
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  paymentMethod: String,
  paidAt: Date,
  failureReason: String
}, { _id: false });

const orderSchema = new Schema({
  orderId: { 
    type: String, 
    required: true, 
    unique: true,
    default: () => `ORD_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
  },
  
  // Customer Information
  customerName: { type: String, required: true },
  customerEmail: { type: String, required: true },
  customerPhone: String,
  
  // Order Items
  items: [orderItemSchema],
  
  // Order Totals
  subtotal: { type: Number, required: true },
  tax: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  totalAmount: { type: Number, required: true },
  
  // Order Status
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'delivered', 'cancelled', 'refunded'],
    default: 'pending'
  },
  
  // Payment Information
  payment: paymentDetailsSchema,
  
  // Digital Product Delivery
  downloadLinks: [{
    productId: String,
    productName: String,
    downloadUrl: String,
    expiresAt: Date,
    downloadCount: { type: Number, default: 0 },
    maxDownloads: { type: Number, default: 5 }
  }],
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  deliveredAt: Date,
  
  // Additional metadata
  metadata: {
    userAgent: String,
    ipAddress: String,
    source: String
  }
}, {
  collection: 'orders'
});

// Update the updatedAt field before saving
orderSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Index for efficient queries
orderSchema.index({ orderId: 1 });
orderSchema.index({ customerEmail: 1 });
orderSchema.index({ 'payment.transactionId': 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ createdAt: -1 });

// Virtual for order summary
orderSchema.virtual('summary').get(function() {
  return {
    orderId: this.orderId,
    customerName: this.customerName,
    totalAmount: this.totalAmount,
    status: this.status,
    itemCount: this.items.length,
    createdAt: this.createdAt
  };
});

// Method to generate download links for digital products
orderSchema.methods.generateDownloadLinks = function() {
  const downloadLinks = this.items.map(item => ({
    productId: item.productId,
    productName: item.name,
    downloadUrl: `${process.env.APP_BASE_URL}/api/download/${this.orderId}/${item.productId}`,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    downloadCount: 0,
    maxDownloads: 5
  }));
  
  this.downloadLinks = downloadLinks;
  return downloadLinks;
};

// Method to update payment status
orderSchema.methods.updatePaymentStatus = function(paymentData) {
  this.payment = { ...this.payment.toObject(), ...paymentData };
  
  if (paymentData.status === 'completed') {
    this.status = 'completed';
    this.payment.paidAt = new Date();
    this.generateDownloadLinks();
  } else if (paymentData.status === 'failed') {
    this.status = 'cancelled';
  }
  
  return this.save();
};

const Order = model('Order', orderSchema);

export default Order;
