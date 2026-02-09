// server.supabase.js
// ============================================================
// Imports & Environment Setup
// ============================================================
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";
import PhonePeAPIService from "../services/phonepeService.js";

dotenv.config();

// ============================================================
// App Initialization
// ============================================================
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "10mb" }));

// ============================================================
// CORS Configuration
// ============================================================
const allowedOrigins = ["http://192.168.31.18:8080", "http://localhost:3000", process.env.FRONTEND_URL].filter(Boolean);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      console.warn("❌ Blocked CORS:", origin);
      return callback(new Error("Not allowed by CORS"), false);
    },
    credentials: true,
    exposedHeaders: ["Content-Disposition"],
  })
);

// ============================================================
// Supabase Client
// ============================================================
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
  console.error("❌ Missing required environment variables");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ============================================================
// Services
// ============================================================
const phonePeService = new PhonePeAPIService();

// ============================================================
// Utility Helpers
// ============================================================
const asyncHandler =
  (fn) =>
    (req, res, next) =>
      Promise.resolve(fn(req, res, next)).catch(next);

function generateMerchantOrderId(customerPhone, productCode = "BUNDLE") {
  return `ORDER_${productCode}_${customerPhone.slice(-4)}_${Date.now()}`;
}

async function findOrderByTransactionId(transactionId) {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .contains("payment", { transactionId })
    .limit(1)
    .single();
  if (error?.code === "PGRST116") return null;
  if (error) throw error;
  return data;
}

async function updateOrderPaymentById(orderId, payment) {
  const { error } = await supabase
    .from("orders")
    .update({ payment, updated_at: new Date() })
    .eq("id", orderId);
  if (error) throw error;
}

// ============================================================
// Health & Root
// ============================================================
app.get("/", (_, res) =>
  res.json({ message: "backend running", time: new Date().toISOString() })
);

app.get("/health", asyncHandler(async (_, res) => {
  const { error } = await supabase.from("products").select("id").limit(1);
  res.json({ status: error ? "unhealthy" : "healthy" });
}));

// ============================================================
// Products CRUD
// ============================================================
app.get("/api/products", asyncHandler(async (_, res) => {
  console.log("Fetching products...");
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("id");
  if (error) throw error;
  res.json(data);
}));

app.get("/api/products/:id", asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", req.params.id)
    .single();
  if (error) throw error;
  res.json(data);
}));

app.post("/api/products", asyncHandler(async (req, res) => {
  const { name, price } = req.body;
  if (!name || !price) {
    return res.status(400).json({ message: "name & price required" });
  }
  const { data, error } = await supabase
    .from("products")
    .insert([{ ...req.body, created_at: new Date() }])
    .select()
    .single();
  if (error) throw error;
  res.status(201).json(data);
}));

app.put("/api/products/:id", asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from("products")
    .update({ ...req.body, updated_at: new Date() })
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) throw error;
  res.json(data);
}));

app.delete("/api/products/:id", asyncHandler(async (req, res) => {
  const { error } = await supabase.from("products").delete().eq("id", req.params.id);
  if (error) throw error;
  res.json({ success: true });
}));

// ============================================================
// PhonePe Order Creation
// ============================================================
app.post("/api/phonepe/create-order", asyncHandler(async (req, res) => {
  const {
    customerName,
    customerEmail,
    customerPhone,
    orderItems,
    totalAmount,
  } = req.body;
  console.log("Received order creation request:", { customerName, customerEmail, customerPhone, orderItems, totalAmount });
  if (!customerName || !customerEmail || !customerPhone || !orderItems?.length) {
    return res.status(400).json({ message: "Invalid payload" });
  }

  // const amountPaise = Math.round(Number(totalAmount) * 100);
  // if (amountPaise <= 0) {
  //   return res.status(400).json({ message: "Invalid amount" });
  // }

  const merchantTransactionId = `TX_${Date.now()}`;
  const merchantOrderId = generateMerchantOrderId(customerPhone);

  // 1️⃣ Create DB order first
  const { data: order, error } = await supabase
    .from("orders")
    .insert([{
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      items: orderItems,
      total_amount: totalAmount,
      payment: {
        gateway: "phonepe",
        transactionId: merchantTransactionId,
        merchantOrderId,
        status: "pending",
        amount: totalAmount,
      },
      created_at: new Date(),
      updated_at: new Date(),
      product_id: orderItems.map((it) => it.id || it.productId || it.product_id),
      merchant_order_id: merchantOrderId,
    }])
    .select()
    .single();

  if (error) throw error;

  // 2️⃣ Initiate PhonePe payment
  const payment = await phonePeService.initiatePayment({
    amount: totalAmount,
    customerName,
    customerEmail,
    customerPhone,
    merchantOrderId,
  });

  if (!payment?.success) {
    await updateOrderPaymentById(order.id, {
      ...order.payment,
      status: "failed",
      failureReason: payment?.error,
    });
    return res.status(502).json({ message: "PhonePe initiation failed" });
  }

  await updateOrderPaymentById(order.id, {
    ...order.payment,
    paymentUrl: payment.paymentUrl,
  });

  res.json({
    success: true,
    orderId: order.id,
    paymentUrl: payment.paymentUrl,
  });
}));


// ============================================================
// PhonePe Callback (Idempotent)
// ============================================================
app.post("/api/phonepe/callback", asyncHandler(async (req, res) => {
  const responseBase64 = req.body.response;

  if (!responseBase64) {
    return res.status(400).send("Invalid callback");
  }

  const decoded = JSON.parse(
    Buffer.from(responseBase64, "base64").toString("utf-8")
  );

  const merchantTransactionId = decoded.data.merchantTransactionId;

  const order = await findOrderByTransactionId(merchantTransactionId);
  if (!order) return res.status(404).send("Order not found");

  if (decoded.code === "PAYMENT_SUCCESS") {
    await updateOrderPaymentById(order.id, {
      ...order.payment,
      status: "completed",
      gatewayTransactionId: decoded.data.transactionId,
      paidAt: new Date(),
    });

    return res.redirect(
      `${process.env.FRONTEND_URL}/payment-success?orderId=${order.id}`
    );
  }

  if (decoded.code === "PAYMENT_FAILED") {
    await updateOrderPaymentById(order.id, {
      ...order.payment,
      status: "failed",
      failureReason: decoded.message,
    });

    return res.redirect(
      `${process.env.FRONTEND_URL}/payment-failed?orderId=${order.id}`
    );
  }

  res.redirect(
    `${process.env.FRONTEND_URL}/payment-pending?orderId=${order.id}`
  );
}));

app.all('/api/phonepe/callback/:orderId', async (req, res) => {
  const { orderId } = req.params;

  console.log('📩 PhonePe Callback for:', orderId);

  // 1. OPTIONAL: Store callback payload
  // console.log(req.body);

  // 2. Verify payment from PhonePe (FINAL SOURCE)
  const result = await phonePeService.verifyPayment(orderId);
  console.log('🔍 Payment verification result:', result);
  if (result.success) {
    // ✅ Redirect user to frontend success page
    await supabase
      .from("orders")
      .update({
        payment: {
          ...result.raw,           // optional full response
          status: "completed",     // ✅ FINAL STATE
          verified_at: new Date(),
        },
        updated_at: new Date(),
      })
      .contains("payment", { merchantOrderId: orderId });
    return res.redirect(
      `${process.env.FRONTEND_URL}/payment-success?orderId=${orderId}`
    );
  } else {
    // ❌ Redirect to failure page
    return res.redirect(
      `${process.env.FRONTEND_URL}/payment-failed?orderId=${orderId}`
    );
  }
});


app.get("/api/orders/:orderId", asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  console.log("Fetching order details for:", orderId);
  if (!orderId) {
    return res.status(400).json({ message: "orderId is required" });
  }

  // Fetch order from Supabase
  const { data: order, error } = await supabase
    .from("orders")
    .select(`
      id,
      customer_name,
      customer_email,
      total_amount,
      items
    `)
    .eq("merchant_order_id", orderId)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return res.status(404).json({ message: "Order not found" });
    }
    throw error;
  }

  // ✅ Shape response exactly as frontend expects
  res.json({
    id: order.id,
    customer_name: order.customer_name,
    customer_email: order.customer_email,
    total_amount: Number(order.total_amount),
    items: Array.isArray(order.items)
      ? order.items.map((item) => ({
        id: item.id,
        name: item.name,
        price: Number(item.price),
        quantity: Number(item.quantity),
      }))
      : [],
  });
}));




// GET /api/signed-download/:productId?transactionId=...
app.get("/api/signed-download/:productId", async (req, res) => {
  try {
    const { productId } = req.params;
    const orderId = String(req.query.orderId || "");

    if (!productId) {
      return res.status(400).json({ success: false, message: "productId required" });
    }

    if (!orderId) {
      return res.status(400).json({ success: false, message: "orderId required" });

    }
    console.log("🔐 Signed download request for product:", productId, "orderId:", orderId);

    // 1️⃣ Fetch order by PRIMARY KEY (CORRECT)
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, payment, items")
      .eq("merchant_order_id", orderId)
      .single();
    console.log("Fetched order for signed download:", order);
    if (orderErr || !order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    // 2️⃣ Ensure payment completed
    console.log("Order payment status:", order.payment?.status);
    if (
      !order.payment ||
      String(order.payment.status).toLowerCase() !== "completed"
    ) {
      return res.status(403).json({ success: false, message: "Payment not completed" });
    }

    // 3️⃣ Verify product belongs to this order
    const included =
      Array.isArray(order.items) &&
      order.items.some(
        (it) => String(it.id || it.productId || it.product_id) === String(productId)
      );

    if (!included) {
      return res.status(403).json({
        success: false,
        message: "Product not part of this order",
      });
    }

    // 4️⃣ Fetch product storage info
    const { data: product, error: prodErr } = await supabase
      .from("products")
      .select("id, storage_path, file_name")
      .eq("id", productId)
      .single();

    if (prodErr || !product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    if (!product.file_name) {
      return res.status(400).json({ success: false, message: "file_name missing" });
    }

    const bucket = product.storage_path || "products";
    const expiresIn = 60;

    // 5️⃣ Create signed URL (IMPORTANT: filename only)
    const { data: signedData, error: urlErr } = await supabase.storage
      .from(bucket)
      .createSignedUrl(product.file_name, expiresIn);

    if (urlErr || !signedData?.signedUrl) {
      console.error("Signed URL error:", urlErr);
      return res.status(500).json({ success: false, message: "Could not create signed URL" });
    }

    // ✅ ALWAYS return JSON (never redirect)
    return res.json({
      success: true,
      signedUrl: signedData.signedUrl,
      expiresIn,
    });
  } catch (err) {
    console.error("Signed download error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});








// ============================================================
// Admin Login (Secure)
// ============================================================
app.post("/api/admin/login", asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ message: "Missing credentials" });

  const { data: admin, error } = await supabase
    .from("admin")
    .select("id, username, password_hash, role")
    .eq("username", username)
    .single();

  if (error || !admin || !(await bcrypt.compare(password, admin.password_hash))) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const token = jwt.sign(
    { id: admin.id, role: admin.role },
    JWT_SECRET,
    { expiresIn: "8h" }
  );

  res.json({ success: true, token, user: { id: admin.id, role: admin.role } });
}));

// ============================================================
// Global Error Handler
// ============================================================
app.use((err, _req, res, _next) => {
  console.error("💥 Unhandled Error:", err);
  res.status(500).json({ message: "Internal server error" });
});

// ============================================================
// Server Start
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));

export default app;
