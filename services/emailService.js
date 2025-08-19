// services/emailService.js
const sgMail = require('@sendgrid/mail');

// Set your SendGrid API key
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

/**
 * Sends the order confirmation email using the official SendGrid library.
 * @param {string} recipientEmail - The customer's email address.
 * @param {object} templateData - An object with all the data for the placeholders.
 */
const sendOrderConfirmation = async (recipientEmail, templateData) => {
  const msg = {
    to: recipientEmail,
    from: 'HatForge <bishal.adhikari03@gmail.com>', // Your verified sender email
    templateId: 'd-9e2aaf1906224519898338cbbb8eb95f',   // Your Template ID
    subject: `Your HatForge Order #${templateData.order_id} is in the queue!`,
    dynamicTemplateData: templateData,                 // The data for your template
 
  };

  try {
    await sgMail.send(msg);
    console.log(`Confirmation email sent to ${recipientEmail}.`);
  } catch (error) {
    console.error('Error sending email via SendGrid:', error);
    if (error.response) {
      // This helps log detailed errors from SendGrid's API
      console.error(error.response.body);
    }
    throw new Error('Email could not be sent.');
  }
};

module.exports = { sendOrderConfirmation };