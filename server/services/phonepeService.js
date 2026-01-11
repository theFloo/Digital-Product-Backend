import crypto from "crypto";
import axios from "axios";

class PhonePeAPIService {
  constructor() {
    this.validateConfig();

    this.merchantId = process.env.PHONEPE_MERCHANT_ID || "PGTESTPAYUAT86";
    this.saltKey =
      process.env.PHONEPE_SALT_KEY || "96434309-7796-489d-8924-ab56988a6076";
    this.saltIndex = process.env.PHONEPE_SALT_INDEX || "1";
    this.clientId = process.env.PHONEPE_CLIENT_ID || "test-client-id";
    this.clientSecret =
      process.env.PHONEPE_CLIENT_SECRET || "test-client-secret";
    this.clientVersion =
      process.env.PHONEPE_CLIENT_VERSION || "test-client-version";
    this.appBaseUrl = process.env.APP_BASE_URL;

    const isProd = process.env.NODE_ENV === "production";
    this.baseUrls = {
      auth: isProd
        ? "https://api.phonepe.com/apis/identity-manager"
        : "https://api-preprod.phonepe.com/apis/pg-sandbox",
      payment: isProd
        ? "https://api.phonepe.com/apis/pg"
        : "https://api-preprod.phonepe.com/apis/pg-sandbox",
    };

    this.accessToken = null;
    this.tokenExpiry = null;

    console.log(
      `📡 PhonePe Service initialized in ${
        isProd ? "Production" : "Sandbox"
      } mode`
    );
  }

  validateConfig() {
    const required = ["APP_BASE_URL"];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length) {
      throw new Error(
        `Missing required environment variables: ${missing.join(", ")}`
      );
    }
  }

  /** 🔑 Get OAuth token (cached) */
  async getAccessToken() {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      const res = await axios.post(
        `${this.baseUrls.auth}/v1/oauth/token`,
        new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.clientId,
          client_secret: this.clientSecret,
          client_version: this.clientVersion,
        }),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            accept: "application/json",
          },
        }
      );

      if (!res.data.access_token)
        throw new Error("No access_token in response");

      this.accessToken = res.data.access_token;
      this.tokenExpiry = Date.now() + (res.data.expires_in - 300) * 1000; // refresh 5 mins early

      console.log("🔑 OAuth token refreshed");
      return this.accessToken;
    } catch (err) {
      console.error("OAuth error:", err.response?.data || err.message);
      if (process.env.NODE_ENV !== "production") {
        console.log("⚠️ Sandbox mode: continuing without token");
        return null;
      }
      throw err;
    }
  }
  async   (customerPhone, productCode = "BUNDLE") {
    const timestamp = Date.now(); // 13-digit epoch
    const random = Math.floor(Math.random() * 9000 + 1000); // 4-digit random number
    const phoneSuffix = customerPhone.slice(-4); // last 4 digits
    return `ORDER_${productCode}_${phoneSuffix}_${timestamp}_${random}`;
  }

  /** 💳 Initiate payment (v2 OAuth-based) */
async initiatePayment(paymentData) {
  try {
    const {
      amount,
      customerPhone,
      customerName,
      customerEmail,
      merchantTransactionId,
      merchantOrderId
    } = paymentData;

    // 🔒 1. Validate required data
    this.validatePaymentData({ amount, customerPhone, customerName });

    // 🧭 2. Use environment variables properly
    const FRONTEND_URL = process.env.FRONTEND_URL || "https://www.thefloo.shop";
    const BACKEND_URL = process.env.BACKEND_URL || "https://api.thefloo.shop";

    console.log("🚀 Initiating PhonePe Payment:", {
      merchantTransactionId,
      merchantOrderId,
      amount,
      customerPhone,
      backendRedirectUrl: `${BACKEND_URL}/api/phonepe/callback/${merchantTransactionId}`,
    });

    // 💰 3. Construct payment payload
    const paymentPayload = {
      merchantTransactionId,
      merchantOrderId,
      merchantId: this.merchantId,
      amount: Math.round(amount * 100), // convert to paise
      expireAfter: 1200, // 20 minutes
      metaInfo: {
        udf1: customerName || "NA",
        udf2: customerEmail || "NA",
        udf3: customerPhone || "NA",
        udf4: "bundle-buy-bliss",
        udf5: merchantTransactionId,
      },
      paymentFlow: {
        type: "PG_CHECKOUT",
        message: "Redirecting to PhonePe",
        merchantUrls: {
          // ✅ redirect back to your backend (NOT frontend)
          redirectUrl: `${BACKEND_URL}/api/phonepe/callback/${merchantTransactionId}`,
        },
      },
    };

    // 🔑 4. Get access token
    const accessToken = await this.getAccessToken();
    if (!accessToken)
      throw new Error("Access token required for PhonePe v2 payment");

    const headers = {
      "Content-Type": "application/json",
      Authorization: `O-Bearer ${accessToken}`,
    };

    // 📡 5. Call PhonePe API
    const apiResponse = await axios.post(
      `${this.baseUrls.payment}/checkout/v2/pay`,
      paymentPayload,
      { headers, timeout: 30000 }
    );

    console.log("📨 PhonePe API Response:", apiResponse.data);

    // 🧭 6. Return redirect info to frontend
    if (apiResponse.status === 200 && apiResponse.data?.redirectUrl) {
      return {
        success: true,
        paymentUrl: apiResponse.data.redirectUrl,
        merchantTransactionId,
        merchantOrderId,
        state: apiResponse.data.state,
      };
    }

    throw new Error(apiResponse.data?.message || "Unexpected API response");
  } catch (error) {
    console.error("💥 Payment initiation failed:", error.message);
    return {
      success: false,
      error: this.getErrorMessage(error),
      debug: {
        responseData: error.response?.data,
        statusCode: error.response?.status,
      },
    };
  }
}


  /** 🧾 Check payment status */
  async checkPaymentStatus(merchantOrderId) {
    try {
      if (!merchantOrderId) throw new Error("merchantOrderId required");

      const token = await this.getAccessToken();
      if (!token) throw new Error("Missing PhonePe OAuth token");
console.log(token)
      const options = {
        method: "GET",
        url: `${this.baseUrls.payment}/checkout/v2/order/${merchantOrderId}/status`,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `O-Bearer ${token}`, // 👈 v2 OAuth token
          "X-MERCHANT-ID": process.env.PHONEPE_MERCHANT_ID, // 👈 v2 OAuth token
        },
      };

      const response = await axios.request(options);
      console.log("📨 Status Response:", response.data);

      return response.data; // Return the full response object
    } catch (error) {
      console.error("❌ Error fetching status:", error.response?.data || error.message);
      // Re-throw or return a structured error
      throw new Error(error.response?.data?.message || 'Status check failed');
    }
  }
  /** 📞 Verify callback from PhonePe */
  async verifyCallback({ response, checksum }) {
    if (!response || !checksum)
      return { isValid: false, error: "Missing response or checksum" };

    const expected =
      crypto
        .createHash("sha256")
        .update(response + this.saltKey)
        .digest("hex") +
      "###" +
      this.saltIndex;

    if (checksum !== expected)
      return { isValid: false, error: "Checksum mismatch" };

    const decoded = JSON.parse(
      Buffer.from(response, "base64").toString("utf8")
    );
    return { isValid: true, data: decoded };
  }

  getStatusMessage(state) {
    switch (state) {
      case "COMPLETED":
        return "Payment completed successfully.";
      case "FAILED":
        return "Payment failed.";
      case "PENDING":
        return "Payment is pending.";
      default:
        return "Unknown payment state.";
    }
  }

  getErrorMessage(err) {
    return (
      err.response?.data?.message ||
      err.response?.data?.error ||
      err.message ||
      "Unexpected error"
    );
  }

  validatePaymentData({ amount, customerPhone, customerName }) {
    if (!amount || amount <= 0) throw new Error("Invalid amount");
    if (!customerPhone || customerPhone.length < 10)
      throw new Error("Invalid phone number");
    if (!customerName?.trim()) throw new Error("Customer name required");
  }
}

export default PhonePeAPIService;
