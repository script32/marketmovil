const domesticShippingAmount = 10;
const internationalShippingAmount = 25;
const freeThreshold = 100;
const shippingFromCountry = 'Chile';

const calculateShipping = (amount, config, req) => {
    // When set to instore shipping is not applicable.
    if(config.paymentGateway === 'instore'){
        // Update message and amount
        req.session.shippingMessage = 'Envio a su Hogar';
        req.session.totalCartShipping = 0;
        req.session.totalCartAmount = req.session.totalCartAmount + 0;
        return;
    }

    if(amount >= freeThreshold){
        req.session.shippingMessage = 'Envio Gratis';
        req.session.totalCartShipping = 0;
        req.session.totalCartAmount = req.session.totalCartAmount + 0;
        return;
    }

    // If there is no country set, we estimate shipping
    if(!req.session.customerCountry){
        req.session.shippingMessage = 'Envío estimado';
        req.session.totalCartShipping = domesticShippingAmount;
        req.session.totalCartAmount = amount + domesticShippingAmount;
        return;
    }

    // Check for international
    if(req.session.customerCountry.toLowerCase() !== shippingFromCountry.toLowerCase()){
        req.session.shippingMessage = 'Ienvío internacional';
        req.session.totalCartShipping = internationalShippingAmount;
        req.session.totalCartAmount = amount + internationalShippingAmount;
        return;
    }

    // Domestic shipping
    req.session.shippingMessage = 'envio domestico';
    req.session.totalCartShipping = domesticShippingAmount;
    req.session.totalCartAmount = amount + domesticShippingAmount;
};

module.exports = {
    calculateShipping
};
