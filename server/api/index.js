// server.supabase.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import PhonePeAPIService from "../services/phonepeService.js";

dotenv.config();

const app = express();
const allowedOrigins = [
  "https://thefloo.shop",
  "https://www.thefloo.shop",
  "http://localhost:3000",
   "http://localhost:8080", // optional for local dev
];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow no-origin requests (e.g., curl, server-side)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        console.warn(`❌ Blocked CORS request from origin: ${origin}`);
        return callback(new Error("Not allowed by CORS"), false);
      }
    },
    credentials: true, // required if you use cookies or auth headers
    exposedHeaders: ["Content-Disposition"], // allow filename header for downloads
  })
);
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
    const { id, name, price, description, detail_description, image, category, popular, rating, features, url } =
      req.body;

    // Basic validation
    if (!name || !price) {
      return res.status(400).json({
        success: false,
        message: "Name and price are required",
      });
    }

    const { data, error } = await supabase
      .from("products")
      .insert([
        {
          id,
          name,
          price,
          description,
          detail_description,
          image,
          category,
          file_name: req.name.replace(/\s+/g, "_").toLowerCase() + ".pdf",
          popular: popular ?? false,
          rating: rating ?? 0,
          features: features ?? [],
          url,
          created_at: new Date(),
        },
      ])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      product: data,
    });
  } catch (error) {
    console.error("❌ Error creating product:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
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


// Get order by transaction ID
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
// app.get("/api/phonepe/callback/:merchantTransactionId", async (req, res) => {
//   try {
//     const { merchantTransactionId } = req.params;
//     const order = await findOrderByTransactionId(merchantTransactionId);
//     if (!order) return res.redirect(`${process.env.FRONTEND_URL || "http://localhost:8080"}/payment-error?error=order-not-found`);

//     const statusResponse = await phonePeService.checkPaymentStatus(order.payment.merchantOrderId);
//     const updateOrderStatus = async (updates) => await updateOrderPaymentById(order.id, { ...(order.payment || {}), ...updates });

//     switch (statusResponse.state) {
//       case "COMPLETED":
//         await updateOrderStatus({ status: "completed", gatewayTransactionId: statusResponse.transactionId, paymentMethod: statusResponse.paymentInstrument?.type || "UPI", paidAt: new Date() });
//         return res.redirect(`${process.env.FRONTEND_URL}/payment-success?orderId=${order.id}&transactionId=${merchantTransactionId}`);
//       case "FAILED":
//         await updateOrderStatus({ status: "failed", failureReason: statusResponse.error || "Payment failed" });
//         return res.redirect(`${process.env.FRONTEND_URL}/payment-failed?orderId=${order.id}`);
//       default:
//         return res.redirect(`${process.env.FRONTEND_URL}/payment-pending?orderId=${order.id}&transactionId=${merchantTransactionId}`);
//     }
//   } catch (error) {
//     res.redirect(`${process.env.FRONTEND_URL || "http://localhost:8080"}/payment-error?error=callback-failed`);
//   }
// });



app.get("/api/phonepe/callback/:merchantTransactionId", async (req, res) => {
  const { merchantTransactionId } = req.params;

  const FRONTEND_URL = process.env.FRONTEND_URL || "https://www.thefloo.shop";

  try {
    if (!merchantTransactionId || !/^TX_|BBB_/.test(merchantTransactionId)) {
      console.warn("⚠️ Invalid transaction ID:", merchantTransactionId);
      return res.redirect(`${FRONTEND_URL}/payment-error?error=invalid-transaction`);
    }

    console.log("📞 PhonePe callback received:", merchantTransactionId);

    const order = await findOrderByTransactionId(merchantTransactionId);
    if (!order) {
      console.error("❌ Order not found for transaction:", merchantTransactionId);
      return res.redirect(`${FRONTEND_URL}/payment-error?error=order-not-found`);
    }

    // 🔍 Fetch latest status from PhonePe
    const statusResponse = await phonePeService.checkPaymentStatus(order.payment.merchantOrderId);
    console.log("📦 PhonePe status response:", statusResponse);

    const updateOrderStatus = async (updates) => {
      await updateOrderPaymentById(order.id, { ...(order.payment || {}), ...updates });
    };

    switch (statusResponse?.state) {
      case "COMPLETED":
        await updateOrderStatus({
          status: "completed",
          gatewayTransactionId: statusResponse.transactionId,
          paymentMethod: statusResponse.paymentInstrument?.type || "UPI",
          paidAt: new Date(),
        });
        console.log("✅ Payment completed:", merchantTransactionId);
        return res.redirect(`${FRONTEND_URL}/payment-success?orderId=${order.id}&transactionId=${merchantTransactionId}`);

      case "FAILED":
        await updateOrderStatus({
          status: "failed",
          failureReason: statusResponse.error || "Payment failed",
        });
        console.warn("❌ Payment failed:", merchantTransactionId);
        return res.redirect(`${FRONTEND_URL}/payment-failed?orderId=${order.id}`);

      case "PENDING":
      default:
        await updateOrderStatus({
          status: "pending",
          lastCheckedAt: new Date(),
        });
        console.log("⏳ Payment pending or cancelled:", merchantTransactionId);
        return res.redirect(`${FRONTEND_URL}/payment-error?error=cancelled-or-timeout&transactionId=${merchantTransactionId}`);
    }
  } catch (error) {
    console.error("💥 Callback error:", error.message);
    return res.redirect(`${FRONTEND_URL}/payment-error?error=callback-failed`);
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


// Add this route (place below your other routes)
// GET /api/downloads/:productId?transactionId=TX_...
app.get("/api/downloads/:productId", async (req, res) => {
  try {
    const { productId } = req.params;
    const transactionId = req.query.transactionId;

    if (!productId) {
      return res.status(400).json({ success: false, message: "productId required" });
    }
    if (!transactionId) {
      return res.status(400).json({ success: false, message: "transactionId required" });
    }

    // 1) Find the order by transactionId (your helper)
    const order = await findOrderByTransactionId(String(transactionId));
    if (!order) {
      console.warn("Order not found for transaction:", transactionId);
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    // 2) Ensure payment is completed
    const payment = order.payment || {};
    if (!payment.status || String(payment.status).toLowerCase() !== "completed") {
      console.warn("Payment not completed for order:", order.id, "status:", payment.status);
      return res.status(403).json({ success: false, message: "Payment is not completed for this order" });
    }

    // 3) Verify product included in order
    let productIncluded = false;
    if (Array.isArray(order.items)) {
      productIncluded = order.items.some((it) => {
        if (!it) return false;
        return String(it.productId || it.product_id || it.id) === String(productId);
      });
    }
    if (!productIncluded && order.product_id) {
      productIncluded = String(order.product_id) === String(productId);
    }

    if (!productIncluded) {
      console.warn("Product not in order:", { orderId: order.id, productId });
      return res.status(403).json({ success: false, message: "Product not found in this order" });
    }

    // 4) Fetch product row safely (use select('*') to avoid trailing comma bugs)
    const { data: product, error: productErr } = await supabase
      .from("products")
      .select("*")
      .eq("id", productId)
      .limit(1)
      .single();

    if (productErr || !product) {
      console.error("Product lookup failed:", productErr?.message || "not found");
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    // 5) Determine filename
    const rawFilename = product.file_name || product.local_file_name || (product.name ? `${product.name}.pdf` : null);
    if (!rawFilename) {
      return res.status(400).json({ success: false, message: "No file configured for product" });
    }

    // 6) Sanitize and resolve path
    const PRODUCTS_FOLDER = process.env.PRODUCTS_FOLDER || path.join(process.cwd(), "products");
    const basename = path.basename(rawFilename); // remove path segments
    const ext = path.extname(basename).toLowerCase();
    const finalFilename = ext === ".pdf" ? basename : `${basename}.pdf`;
    const absolutePath = path.resolve(PRODUCTS_FOLDER, finalFilename);

    // ensure inside PRODUCTS_FOLDER
    if (!absolutePath.startsWith(path.resolve(PRODUCTS_FOLDER) + path.sep)) {
      console.error("Attempt to access file outside products folder:", absolutePath);
      return res.status(400).json({ success: false, message: "Invalid file path" });
    }

    // 7) File existence
    if (!fs.existsSync(absolutePath)) {
      console.warn("File not found on disk:", absolutePath);
      return res.status(404).json({ success: false, message: "File not found" });
    }

    // 8) Stream file with Content-Disposition header (safe filename)
    const safeDownloadName =
      (product.name || path.parse(finalFilename).name).replace(/[^a-z0-9_\-\. ]/gi, "_").trim() + ".pdf";

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeDownloadName}"; filename*=UTF-8''${encodeURIComponent(safeDownloadName)}`
    );
    res.setHeader("Cache-Control", "no-cache");

    const stream = fs.createReadStream(absolutePath);
    stream.on("error", (err) => {
      console.error("File stream error:", err);
      if (!res.headersSent) res.status(500).json({ success: false, message: "File read error" });
    });
    stream.pipe(res);
  } catch (err) {
    // log the internal error and return a controlled message
    console.error("Authorized download error:", err?.message || err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});


// GET /api/signed-download/:productId?transactionId=...
app.get("/api/signed-download/:productId", async (req, res) => {
  try {
    const { productId } = req.params;
    const transactionId = String(req.query.transactionId || "");

    if (!productId) return res.status(400).json({ success: false, message: "productId required" });
    if (!transactionId) return res.status(400).json({ success: false, message: "transactionId required" });

    // 1) validate order and payment (reuse your helper)
    const order = await findOrderByTransactionId(transactionId);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (!order.payment || String(order.payment.status).toLowerCase() !== "completed") {
      return res.status(403).json({ success: false, message: "Payment not completed" });
    }

    // 2) verify product included in order (same logic you have)
    let included = false;
    if (Array.isArray(order.items)) {
      included = order.items.some((it) => String(it.productId || it.product_id || it.id) === String(productId));
    }
    if (!included && order.product_id) included = String(order.product_id) === String(productId);
    if (!included) return res.status(403).json({ success: false, message: "Product not part of this order" });

   // 3) get product row to find storage path
const { data: product, error: prodErr } = await supabase
  .from("products")
  .select("id, name, storage_path, file_name")
  .eq("id", productId)
  .single();

if (prodErr || !product) {
  console.error("Product lookup failed:", prodErr?.message);
  return res.status(404).json({ success: false, message: "Product not found" });
}

// ✅ storage_path = bucket, file_name = file in that bucket
const bucket = product.storage_path || "products"; // default fallback
const fileName = product.file_name;

if (!fileName) {
  return res.status(400).json({ success: false, message: "file_name missing for product" });
}

// ✅ join bucket and filename for Supabase path
const filePath = `${bucket}/${fileName}`.replace(/\/+/g, "/"); // ensure no double slashes

console.log("📦 Downloading from Supabase:", { bucket, fileName, filePath });

// 4) create signed URL
const expiresIn = 60; // seconds
const { data: signedData, error: urlErr } = await supabase.storage
  .from(bucket)
  .createSignedUrl(fileName, expiresIn); // use only the relative filename inside the bucket

if (urlErr || !signedData) {
  console.error("Signed URL error:", urlErr);
  return res.status(500).json({ success: false, message: "Could not create signed URL" });
}

return res.json({
  success: true,
  signedUrl: signedData.signedUrl,
  fileName,
  bucket,
  expiresIn,
});
    // Option A: redirect client to signedURL (browser will download/open it)
    // return res.redirect(signedURL);

    // Option B: return JSON with signed URL (frontend will download it)
  } catch (err) {
    console.error("Signed download error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));

export default app;
