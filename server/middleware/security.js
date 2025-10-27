import crypto from 'crypto';
import rateLimit from 'express-rate-limit';

/**
 * Rate limiting middleware for payment endpoints
 */
const paymentRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 payment requests per windowMs
  message: {
    success: false,
    message: 'Too many payment requests, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiting for status check endpoints
 */
const statusCheckRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Limit each IP to 30 status checks per minute
  message: {
    success: false,
    message: 'Too many status check requests, please try again later.'
  }
});

/**
 * Validate request data for payment creation
 */
const validatePaymentRequest = (req, res, next) => {
  const { customerName, customerEmail, orderItems, totalAmount } = req.body;

  // Basic validation
  if (!customerName || typeof customerName !== 'string' || customerName.trim().length < 2) {
    return res.status(400).json({
      success: false,
      message: 'Valid customer name is required'
    });
  }

  if (!customerEmail || !isValidEmail(customerEmail)) {
    return res.status(400).json({
      success: false,
      message: 'Valid email address is required'
    });
  }

  if (!orderItems || !Array.isArray(orderItems) || orderItems.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Order items are required'
    });
  }

  if (!totalAmount || typeof totalAmount !== 'number' || totalAmount <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Valid total amount is required'
    });
  }

  // Validate amount limits
  if (totalAmount < 1 || totalAmount > 200000) { // ₹1 to ₹2,00,000
    return res.status(400).json({
      success: false,
      message: 'Amount must be between ₹1 and ₹2,00,000'
    });
  }

  // Validate order items
  for (const item of orderItems) {
    if (!item.id || !item.name || !item.price || !item.quantity) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order item data'
      });
    }

    if (item.price <= 0 || item.quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Item price and quantity must be positive'
      });
    }
  }

  // Calculate and verify total amount
  const calculatedTotal = orderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  if (Math.abs(calculatedTotal - totalAmount) > 0.01) { // Allow for small floating point differences
    return res.status(400).json({
      success: false,
      message: 'Total amount mismatch'
    });
  }

  next();
};

/**
 * Sanitize input data
 */
const sanitizeInput = (req, res, next) => {
  if (req.body.customerName) {
    req.body.customerName = req.body.customerName.trim().replace(/[<>]/g, '');
  }
  
  if (req.body.customerEmail) {
    req.body.customerEmail = req.body.customerEmail.trim().toLowerCase();
  }

  next();
};

/**
 * Validate merchant transaction ID format
 */
const validateMerchantOrderId = (req, res, next) => {
  const { merchantOrderId } = req.params;

  // Expect something like: ORDER_<PRODUCT>_<last4Phone>_<timestamp>_<random4>
  const pattern = /^ORDER_[A-Z0-9]+_\d{4}_\d{13}_\d{4}$/;

  if (!merchantOrderId || !merchantOrderId.match(pattern)) {
    return res.status(400).json({
      success: false,
      message: "Invalid merchantOrderId format",
    });
  }

  next();
};


/**
 * Security headers middleware
 */
const securityHeaders = (req, res, next) => {
  // Remove server information
  res.removeHeader('X-Powered-By');
  
  // Add security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Add CORS headers for payment endpoints
  if (req.path.includes('/api/phonepe/')) {
    res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || 'http://localhost:8080');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  next();
};

/**
 * Log payment attempts for monitoring
 */
const logPaymentAttempt = (req, res, next) => {
  const clientIP = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent');
  const timestamp = new Date().toISOString();
  
  console.log(`[PAYMENT ATTEMPT] ${timestamp} - IP: ${clientIP} - User-Agent: ${userAgent} - Path: ${req.path}`);
  
  // Store in request for later use
  req.securityContext = {
    clientIP,
    userAgent,
    timestamp
  };

  next();
};

/**
 * Validate webhook signature (for PhonePe webhooks)
 */
const validateWebhookSignature = (req, res, next) => {
  try {
    const signature = req.get('X-VERIFY');
    const body = JSON.stringify(req.body);
    
    if (!signature) {
      return res.status(401).json({
        success: false,
        message: 'Missing webhook signature'
      });
    }

    // Verify signature using PhonePe's method
    const expectedSignature = generateWebhookSignature(body);
    
    if (signature !== expectedSignature) {
      console.error('Webhook signature mismatch');
      return res.status(401).json({
        success: false,
        message: 'Invalid webhook signature'
      });
    }

    next();
  } catch (error) {
    console.error('Webhook validation error:', error);
    return res.status(500).json({
      success: false,
      message: 'Webhook validation failed'
    });
  }
};

// Helper functions
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function generateWebhookSignature(body) {
  const saltKey = process.env.PHONEPE_SALT_KEY;
  const saltIndex = process.env.PHONEPE_SALT_INDEX || 1;
  
  const string = body + '/pg/v1/webhook' + saltKey;
  const hash = crypto.createHash('sha256').update(string).digest('hex');
  
  return `${hash}###${saltIndex}`;
}

export {
  paymentRateLimit,
  statusCheckRateLimit,
  validatePaymentRequest,
  sanitizeInput,
  validateMerchantOrderId,
  securityHeaders,
  logPaymentAttempt,
  validateWebhookSignature
};
