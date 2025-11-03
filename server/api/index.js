// server.supabase.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import PhonePeAPIService from "../services/phonepeService.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.set("trust proxy", 1);

// --- Supabase client ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// --- Services ---
const phonePeService = new PhonePeAPIService();

// --- Helpers: DB operations ---
async function getAllProducts() {
  const { data, error } = await supabase.from("products").select("*");
  if (error) throw error;
  return data;
}

async function createOrder(orderPayload) {
  const { data, error } = await supabase
    .from("orders")
    .insert([orderPayload])
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function findOrderByTransactionId(merchantTransactionId) {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .contains("payment", { transactionId: merchantTransactionId })
    .limit(1)
    .single();
  if (error && error.code === "PGRST116") return null;
  if (error) throw error;
  return data;
}
async function getOrderIdByTransactionId(merchantTransactionId) {
  const { data, error } = await supabase
    .from("orders")
    .select("id") // fetch only the order ID
    .contains("payment", { transactionId: merchantTransactionId })
    .limit(1)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null; // not found
    throw error;
  }

  return data?.id || null; // return just the order ID
}

async function updateOrderPaymentById(orderId, paymentUpdates) {
  const { data, error } = await supabase
    .from("orders")
    .update({ payment: paymentUpdates, updated_at: new Date() })
    .eq("id", orderId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

function generateMerchantOrderId(customerPhone, productCode = "BUNDLE") {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 9000 + 1000);
  const phoneSuffix = customerPhone.slice(-4);
  return `ORDER_${productCode}_${phoneSuffix}_${timestamp}_${random}`;
}

// --- Routes ---
app.get("/", (req, res) => {
  res.json({ message: "API running", timestamp: new Date().toISOString() });
});

// Products
// --- PRODUCTS CRUD --- //

// Get all products
app.get("/api/products", async (req, res) => {
  try {
    const { data, error } = await supabase.from("products").select("*").order("id", { ascending: true });
    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get single product by ID
app.get("/api/products/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.from("products").select("*").eq("id", id).single();
    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Create new product
app.post("/api/products", async (req, res) => {
  try {
    const { title, description, price, image_url, category } = req.body;

    if (!title || !price)
      return res.status(400).json({ success: false, message: "title and price are required" });

    const { data, error } = await supabase
      .from("products")
      .insert([{ title, description, price, image_url, category, created_at: new Date() }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, product: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update product
app.put("/api/products/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const { data, error } = await supabase
      .from("products")
      .update({ ...updates, updated_at: new Date() })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    res.status(200).json({ success: true, product: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete product
app.delete("/api/products/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) throw error;
    res.status(200).json({ success: true, message: "Product deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});


app.get("/api/orders/:transactionId", async (req, res) => {
  try {
    const { transactionId } = req.params;
    const order = await findOrderByTransactionId(transactionId);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.json(order);
  } catch (err) {
    console.error("Error fetching order:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});


// PhonePe: Create order & initiate payment
app.post("/api/phonepe/create-order", async (req, res) => {
  try {
    const { customerName, customerEmail, customerPhone, orderItems, totalAmount } = req.body;
    if (!customerName || !customerEmail || !customerPhone || !Array.isArray(orderItems) || !totalAmount)
      return res.status(400).json({ success: false, message: "Missing required fields" });

    const merchantTransactionId = `TX_${Date.now()}`;
    const merchantOrderId = generateMerchantOrderId(customerPhone, "BUNDLE");

    const orderPayload = {
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      items: orderItems,
      subtotal: totalAmount,
      total_amount: totalAmount,
      payment: {
        transactionId: merchantTransactionId,
        merchantOrderId,
        gateway: "phonepe",
        amount: totalAmount,
        status: "pending",
      },
      created_at: new Date(),
      updated_at: new Date(),
    };

    const savedOrder = await createOrder(orderPayload);

    const paymentResponse = await phonePeService.initiatePayment({
      amount: totalAmount,
      customerPhone,
      customerName,
      customerEmail,
      merchantTransactionId,
      merchantOrderId,
    });

    if (paymentResponse.success && paymentResponse.paymentUrl) {
      const finalPayment = { ...savedOrder.payment, transactionId: paymentResponse.merchantTransactionId || merchantTransactionId, paymentUrl: paymentResponse.paymentUrl };
      await updateOrderPaymentById(savedOrder.id, finalPayment);
      return res.status(200).json({ success: true, orderId: savedOrder.id, paymentUrl: paymentResponse.paymentUrl });
    }

    await updateOrderPaymentById(savedOrder.id, { ...savedOrder.payment, status: "failed", failureReason: paymentResponse.error || "Payment failed" });
    return res.status(502).json({ success: false, message: paymentResponse.error || "Payment initiation failed" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
});

// PhonePe callback
app.get("/api/phonepe/callback/:merchantTransactionId", async (req, res) => {
  try {
    const { merchantTransactionId } = req.params;
    const order = await findOrderByTransactionId(merchantTransactionId);
    if (!order) return res.redirect(`${process.env.FRONTEND_URL || "http://localhost:8080"}/payment-error?error=order-not-found`);

    const statusResponse = await phonePeService.checkPaymentStatus(order.payment.merchantOrderId);
    const updateOrderStatus = async (updates) => await updateOrderPaymentById(order.id, { ...(order.payment || {}), ...updates });

    switch (statusResponse.state) {
      case "COMPLETED":
        await updateOrderStatus({ status: "completed", gatewayTransactionId: statusResponse.transactionId, paymentMethod: statusResponse.paymentInstrument?.type || "UPI", paidAt: new Date() });
        return res.redirect(`${process.env.FRONTEND_URL}/payment-success?orderId=${order.id}&transactionId=${merchantTransactionId}`);
      case "FAILED":
        await updateOrderStatus({ status: "failed", failureReason: statusResponse.error || "Payment failed" });
        return res.redirect(`${process.env.FRONTEND_URL}/payment-failed?orderId=${order.id}`);
      default:
        return res.redirect(`${process.env.FRONTEND_URL}/payment-pending?orderId=${order.id}&transactionId=${merchantTransactionId}`);
    }
  } catch (error) {
    res.redirect(`${process.env.FRONTEND_URL || "http://localhost:8080"}/payment-error?error=callback-failed`);
  }
});

// --- Admin Login ---
app.post("/api/admin/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: "Username and password are required" });
  }

  try {
    const { data, error } = await supabase
      .from("admin")
      .select("id, username, role")
      .eq("username", username)
      .eq("password", password)
      .single();

    if (error || !data) {
      console.warn("❌ Invalid login attempt:", username);
      return res.status(401).json({ success: false, message: "Invalid username or password" });
    }

    console.log(`✅ Admin logged in: ${data.username} (${data.role})`);
    return res.status(200).json({
      success: true,
      message: "Login successful",
      user: data,
    });
  } catch (err) {
    console.error("💥 Admin login error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});




// Health check
app.get("/health", async (req, res) => {
  try {
    const { error } = await supabase.from("products").select("id").limit(1);
    res.json({ status: error ? "unhealthy" : "healthy", supabase: error ? "error" : "ok" });
  } catch (err) {
    res.json({ status: "unhealthy", error: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));

export default app;
