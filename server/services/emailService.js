import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    // Product download links mapping
    this.productLinks = {
      'COURSE001': 'https://drive.google.com/file/d/1ABC123_ReactCourse/view?usp=sharing',
      'COURSE002': 'https://drive.google.com/file/d/1DEF456_NodeJSCourse/view?usp=sharing',
      'BUNDLE001': 'https://drive.google.com/file/d/1GHI789_WebDevBundle/view?usp=sharing',
      'TEMPLATE001': 'https://drive.google.com/file/d/1JKL012_ReactTemplates/view?usp=sharing',
      'EBOOK001': 'https://drive.google.com/file/d/1MNO345_JSGuide/view?usp=sharing',
      // Add more product links as needed
    };

    // Product images mapping (you can host these on your server or use CDN)
    this.productImages = {
      'COURSE001': 'https://your-domain.com/images/react-course.jpg',
      'COURSE002': 'https://your-domain.com/images/nodejs-course.jpg',
      'BUNDLE001': 'https://your-domain.com/images/webdev-bundle.jpg',
      'TEMPLATE001': 'https://your-domain.com/images/react-templates.jpg',
      'EBOOK001': 'https://your-domain.com/images/js-guide.jpg',
    };
  }

  /**
   * Send order confirmation email with product images and download links
   */
  async sendOrderConfirmationEmail(customerEmail, customerName, orderId, totalAmount, orderItems) {
    try {
      console.log('📧 Preparing order confirmation email...');
      
      const subject = `🎉 Your Digital Products Are Ready! - Order #${orderId}`;
      
      // Generate product list with images and download links
      const productListHTML = this.generateProductListHTML(orderItems);
      
      const emailHTML = this.generateEmailTemplate({
        customerName,
        orderId,
        totalAmount,
        productListHTML,
        orderItems
      });

      const mailOptions = {
        from: {
          name: 'Bundle Buy Bliss',
          address: process.env.EMAIL_USER
        },
        to: customerEmail,
        subject: subject,
        html: emailHTML,
        // Add company logo as attachment
        attachments: [
          {
            filename: 'logo.png',
            path: 'https://your-domain.com/images/logo.png', // Replace with your logo URL
            cid: 'company-logo'
          }
        ]
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('✅ Order confirmation email sent successfully:', result.messageId);
      
      return {
        success: true,
        messageId: result.messageId
      };

    } catch (error) {
      console.error('❌ Email sending failed:', error);
      throw new Error(`Failed to send confirmation email: ${error.message}`);
    }
  }

  /**
   * Generate HTML for product list with images and download links
   */
  generateProductListHTML(orderItems) {
    return orderItems.map(item => {
      const downloadLink = this.productLinks[item.productId] || '#';
      const productImage = this.productImages[item.productId] || 'https://via.placeholder.com/300x200?text=Product+Image';
      
      return `
        <div style="border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; margin: 15px 0; background: #f9f9f9;">
          <div style="display: flex; align-items: center; gap: 20px;">
            <div style="flex-shrink: 0;">
              <img src="${productImage}" alt="${item.name}" style="width: 120px; height: 80px; object-fit: cover; border-radius: 6px; border: 1px solid #ddd;">
            </div>
            <div style="flex-grow: 1;">
              <h3 style="margin: 0 0 8px 0; color: #333; font-size: 18px;">${item.name}</h3>
              <p style="margin: 0 0 8px 0; color: #666; font-size: 14px;">Quantity: ${item.quantity}</p>
              <p style="margin: 0 0 12px 0; color: #007c07; font-weight: bold; font-size: 16px;">₹${item.price}</p>
              <a href="${downloadLink}" 
                 style="display: inline-block; background: #007c07; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 14px;">
                📥 Download Now
              </a>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * Generate complete email template
   */
  generateEmailTemplate({ customerName, orderId, totalAmount, productListHTML, orderItems }) {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Your Digital Products - Bundle Buy Bliss</title>
    </head>
    <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f4;">
      
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #007c07, #17a2b8); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
        <img src="cid:company-logo" alt="Bundle Buy Bliss" style="max-width: 150px; margin-bottom: 15px;">
        <h1 style="color: white; margin: 0; font-size: 28px;">🎉 Thank You, ${customerName}!</h1>
        <p style="color: #e8f5e8; margin: 10px 0 0 0; font-size: 16px;">Your digital products are ready for download</p>
      </div>

      <!-- Main Content -->
      <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        
        <!-- Order Summary -->
        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 25px; border-left: 4px solid #007c07;">
          <h2 style="margin: 0 0 15px 0; color: #007c07; font-size: 20px;">📋 Order Summary</h2>
          <p style="margin: 5px 0; font-size: 16px;"><strong>Order ID:</strong> #${orderId}</p>
          <p style="margin: 5px 0; font-size: 16px;"><strong>Total Amount:</strong> <span style="color: #007c07; font-weight: bold;">₹${totalAmount}</span></p>
          <p style="margin: 5px 0; font-size: 16px;"><strong>Items:</strong> ${orderItems.length} product(s)</p>
          <p style="margin: 5px 0; font-size: 16px;"><strong>Payment Status:</strong> <span style="color: #28a745; font-weight: bold;">✅ Completed</span></p>
        </div>

        <!-- Products Section -->
        <div style="margin-bottom: 25px;">
          <h2 style="color: #007c07; font-size: 22px; margin-bottom: 20px; border-bottom: 2px solid #007c07; padding-bottom: 10px;">
            🎁 Your Digital Products
          </h2>
          ${productListHTML}
        </div>

        <!-- Important Notes -->
        <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 20px; margin-bottom: 25px;">
          <h3 style="margin: 0 0 15px 0; color: #856404; font-size: 18px;">📌 Important Notes:</h3>
          <ul style="margin: 0; padding-left: 20px; color: #856404;">
            <li style="margin-bottom: 8px;">Download links are valid for <strong>30 days</strong> from purchase date</li>
            <li style="margin-bottom: 8px;">Save your products to your device immediately after download</li>
            <li style="margin-bottom: 8px;">If you face any issues, contact our support team</li>
            <li style="margin-bottom: 8px;">Check your spam folder if you don't see this email</li>
          </ul>
        </div>

        <!-- Support Section -->
        <div style="text-align: center; padding: 20px; background: #f8f9fa; border-radius: 8px;">
          <h3 style="margin: 0 0 15px 0; color: #333;">Need Help? 🤝</h3>
          <p style="margin: 0 0 15px 0; color: #666;">Our support team is here to help you!</p>
          <a href="mailto:${process.env.EMAIL_USER}" 
             style="display: inline-block; background: #007c07; color: white; padding: 12px 25px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 5px;">
            📧 Contact Support
          </a>
          <a href="https://your-website.com/support" 
             style="display: inline-block; background: #17a2b8; color: white; padding: 12px 25px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 5px;">
            🌐 Visit Help Center
          </a>
        </div>

      </div>

      <!-- Footer -->
      <div style="text-align: center; padding: 20px; color: #666; font-size: 14px;">
        <p style="margin: 0 0 10px 0;">Thank you for choosing Bundle Buy Bliss! 🚀</p>
        <p style="margin: 0 0 10px 0;">Follow us on social media for updates and new products</p>
        <p style="margin: 0; font-size: 12px; color: #999;">
          © 2025 Bundle Buy Bliss. All rights reserved.<br>
          This email was sent to ${customerName} (${orderItems[0]?.customerEmail || 'customer'})
        </p>
      </div>

    </body>
    </html>
    `;
  }

  /**
   * Test email configuration
   */
  async testEmailConfig() {
    try {
      await this.transporter.verify();
      console.log('✅ Email configuration is valid');
      return true;
    } catch (error) {
      console.error('❌ Email configuration error:', error);
      return false;
    }
  }
}

export default EmailService;
