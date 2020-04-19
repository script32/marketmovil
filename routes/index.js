const express = require('express');
const router = express.Router();
const colors = require('colors');
const hash = require('object-hash');
const stripHtml = require('string-strip-html');
const moment = require('moment');
const _ = require('lodash');
const {
    getId,
    hooker,
    clearSessionValue,
    sortMenu,
    getMenu,
    getPaymentConfig,
    getImages,
    updateTotalCart,
    emptyCart,
    updateSubscriptionCheck,
    paginateData,
    getSort,
    addSitemapProducts,
    getCountryList
} = require('../lib/common');
const countryList = getCountryList();
const cityList = {};

// These is the customer facing routes
router.get('/payment/:orderId', async (req, res, next) => {
    const db = req.app.db;
    const config = req.app.config;

    // Get the order
    const order = await db.orders.findOne({ _id: getId(req.params.orderId) });
    if(!order){
        res.render('error', { title: 'No encontrado', message: 'Orden no encontrada', helpers: req.handlebars.helpers, config });
        return;
    }

    // If stock management is turned on payment approved update stock level
    if(config.trackStock && req.session.paymentApproved){
        // Check to see if already updated to avoid duplicate updating of stock
        if(order.productStockUpdated !== true){
            Object.keys(order.orderProducts).forEach(async (productKey) => {
                const product = order.orderProducts[productKey];
                const dbProduct = await db.products.findOne({ _id: getId(product.productId) });
                let newStockLevel = dbProduct.productStock - product.quantity;
                if(newStockLevel < 1){
                    newStockLevel = 0;
                }

                // Update product stock
                await db.products.updateOne({
                    _id: getId(product.productId)
                }, {
                    $set: {
                        productStock: newStockLevel
                    }
                }, { multi: false });

                // Add stock updated flag to order
                await db.orders.updateOne({
                    _id: getId(order._id)
                }, {
                    $set: {
                        productStockUpdated: true
                    }
                }, { multi: false });
            });
            console.info('Niveles de stock actualizados');
        }
    }

    // If hooks are configured, send hook
    if(config.orderHook){
        await hooker(order);
    };
    let paymentView = `${config.themeViews}payment-complete`;
    if(order.orderPaymentGateway === 'Blockonomics') paymentView = `${config.themeViews}payment-complete-blockonomics`;
    res.render(paymentView, {
        title: 'Pago completado',
        config: req.app.config,
        session: req.session,
        result: order,
        message: clearSessionValue(req.session, 'message'),
        messageType: clearSessionValue(req.session, 'messageType'),
        helpers: req.handlebars.helpers,
        showFooter: 'showFooter',
        menu: sortMenu(await getMenu(db))
    });
});

router.get('/emptycart', async (req, res, next) => {
    emptyCart(req, res, '');
});

router.get('/checkout/information', async (req, res, next) => {
    const config = req.app.config;

    // if there is no items in the cart then render a failure
    if(!req.session.cart){
        req.session.message = 'No hay artículos en su carro. Por favor agregue algunos artículos antes de pagar';
        req.session.messageType = 'danger';
        res.redirect('/');
        return;
    }

    let paymentType = '';
    if(req.session.cartSubscription){
        paymentType = '_subscription';
    }

    // render the payment page
    res.render(`${config.themeViews}checkout-information`, {
        title: 'Checkout - Informacion',
        config: req.app.config,
        session: req.session,
        paymentType,
        cartClose: false,
        page: 'checkout-information',
        countryList,
        cityList,
        message: clearSessionValue(req.session, 'message'),
        messageType: clearSessionValue(req.session, 'messageType'),
        helpers: req.handlebars.helpers,
        showFooter: 'showFooter'
    });
});

router.get('/checkout/shipping', async (req, res, next) => {
    const config = req.app.config;

    // if there is no items in the cart then render a failure
    if(!req.session.cart){
        req.session.message = 'No hay artículos en su carro. Por favor agregue algunos artículos antes de pagar';
        req.session.messageType = 'danger';
        res.redirect('/');
        return;
    }

    if(!req.session.customerEmail){
        req.session.message = 'No se puede proceder al envío sin información del cliente.';
        req.session.messageType = 'danger';
        res.redirect('/checkout/information');
        return;
    }

    // Net cart amount
    const netCartAmount = req.session.totalCartAmount - req.session.totalCartShipping || 0;

    // Recalculate shipping
    config.modules.loaded.shipping.calculateShipping(
        netCartAmount,
        config,
        req
    );

    // render the payment page
    res.render(`${config.themeViews}checkout-shipping`, {
        title: 'Checkout - Shipping',
        config: req.app.config,
        session: req.session,
        cartClose: false,
        cartReadOnly: true,
        page: 'checkout-shipping',
        countryList,
        cityList,
        message: clearSessionValue(req.session, 'message'),
        messageType: clearSessionValue(req.session, 'messageType'),
        helpers: req.handlebars.helpers,
        showFooter: 'showFooter'
    });
});

router.get('/checkout/cart', (req, res) => {
    const config = req.app.config;

    res.render(`${config.themeViews}checkout-cart`, {
        title: 'Checkout - Cart',
        page: req.query.path,
        config,
        session: req.session,
        message: clearSessionValue(req.session, 'message'),
        messageType: clearSessionValue(req.session, 'messageType'),
        helpers: req.handlebars.helpers,
        showFooter: 'showFooter'
    });
});

router.get('/checkout/cartdata', (req, res) => {
    const config = req.app.config;

    res.status(200).json({
        cart: req.session.cart,
        session: req.session,
        currencySymbol: config.currencySymbol || '$'
    });
});

router.get('/checkout/payment', async (req, res) => {
    const config = req.app.config;

    // if there is no items in the cart then render a failure
    if(!req.session.cart){
        req.session.message = 'No hay artículos en su carro. Por favor agregue algunos artículos antes de pagar';
        req.session.messageType = 'danger';
        res.redirect('/');
        return;
    }

    let paymentType = '';
    if(req.session.cartSubscription){
        paymentType = '_subscription';
    }

    // update total cart amount one last time before payment
    await updateTotalCart(req, res);

    res.render(`${config.themeViews}checkout-payment`, {
        title: 'Checkout - Payment',
        config: req.app.config,
        paymentConfig: getPaymentConfig(),
        session: req.session,
        paymentPage: true,
        paymentType,
        cartClose: true,
        cartReadOnly: true,
        page: 'checkout-information',
        countryList,
        cityList,
        message: clearSessionValue(req.session, 'message'),
        messageType: clearSessionValue(req.session, 'messageType'),
        helpers: req.handlebars.helpers,
        showFooter: 'showFooter'
    });
});

router.get('/blockonomics_payment', (req, res, next) => {
    const config = req.app.config;
    let paymentType = '';
    if(req.session.cartSubscription){
        paymentType = '_subscription';
    }
// show bitcoin address and wait for payment, subscribing to wss

    res.render(`${config.themeViews}checkout-blockonomics`, {
        title: 'Checkout - Payment',
        config: req.app.config,
        paymentConfig: getPaymentConfig(),
        session: req.session,
        paymentPage: true,
        paymentType,
        cartClose: true,
        cartReadOnly: true,
        page: 'checkout-information',
        countryList,
        cityList,
        message: clearSessionValue(req.session, 'message'),
        messageType: clearSessionValue(req.session, 'messageType'),
        helpers: req.handlebars.helpers,
        showFooter: 'showFooter'
    });
});

router.post('/checkout/adddiscountcode', async (req, res) => {
    const config = req.app.config;
    const db = req.app.db;

    // if there is no items in the cart return a failure
    if(!req.session.cart){
        res.status(400).json({
            message: 'No hay artículos en su carro.'
        });
        return;
    }

    // Check if the discount module is loaded
    if(!config.modules.loaded.discount){
        res.status(400).json({
            message: 'Acceso denegado.'
        });
        return;
    }

    // Check defined or null
    if(!req.body.discountCode || req.body.discountCode === ''){
        res.status(400).json({
            message: 'El código de descuento no es válido o caducó'
        });
        return;
    }

    // Validate discount code
    const discount = await db.discounts.findOne({ code: req.body.discountCode });
    if(!discount){
        res.status(400).json({
            message: 'El código de descuento no es válido o caducó'
        });
        return;
    }

    // Validate date validity
    if(!moment().isBetween(moment(discount.start), moment(discount.end))){
        res.status(400).json({
            message: 'El descuento ha expirado'
        });
        return;
    }

    // Set the discount code
    req.session.discountCode = discount.code;

    // Update the cart amount
    await updateTotalCart(req, res);

    // Return the message
    res.status(200).json({
        message: 'Código de descuento aplicado'
    });
});

router.post('/checkout/removediscountcode', async (req, res) => {
    // if there is no items in the cart return a failure
    if(!req.session.cart){
        res.status(400).json({
            message: 'No hay artículos en su carrito.'
        });
        return;
    }

    // Delete the discount code
    delete req.session.discountCode;

    // update total cart amount
    await updateTotalCart(req, res);

    // Return the message
    res.status(200).json({
        message: 'Código de descuento eliminado'
    });
});

// show an individual product
router.get('/product/:id', async (req, res) => {
    const db = req.app.db;
    const config = req.app.config;
    const productsIndex = req.app.productsIndex;

    const product = await db.products.findOne({ $or: [{ _id: getId(req.params.id) }, { productPermalink: req.params.id }] });
    
    
    
    if(!product){
        res.render('error', { title: 'Not found', message: 'Orden no encontrada', helpers: req.handlebars.helpers, config });
        return;
    }
    if(product.productPublished === false){
        res.render('error', { title: 'Not found', message: 'Producto no encontrado', helpers: req.handlebars.helpers, config });
        return;
    }


    const productOptions = product.productOptions;

    // If JSON query param return json instead
    if(req.query.json === 'true'){
        res.status(200).json(product);
        return;
    }

    // show the view
    const images = await getImages(product._id, req, res);

    // Related products
    let relatedProducts = {};
    if(config.showRelatedProducts){
        const lunrIdArray = [];
        const productTags = product.productTags.split(',');
        const productTitleWords = product.productTitle.split(' ');
        const searchWords = productTags.concat(productTitleWords);
        searchWords.forEach((word) => {
            productsIndex.search(word).forEach((id) => {
                lunrIdArray.push(getId(id.ref));
            });
        });
        relatedProducts = await db.products.find({
            _id: { $in: lunrIdArray, $ne: product._id }
        }).limit(4).toArray();
    }

    res.render(`${config.themeViews}product`, {
        title: product.productTitle,
        result: product,
        productOptions: productOptions,
        images: images,
        relatedProducts,
        productDescription: stripHtml(product.productDescription),
        metaDescription: config.cartTitle + ' - ' + product.productTitle,
        config: config,
        session: req.session,
        pageUrl: config.baseUrl + req.originalUrl,
        message: clearSessionValue(req.session, 'message'),
        messageType: clearSessionValue(req.session, 'messageType'),
        helpers: req.handlebars.helpers,
        showFooter: 'showFooter',
        menu: sortMenu(await getMenu(db))
    });
});

// Gets the current cart
router.get('/cart/retrieve', async (req, res, next) => {
    const db = req.app.db;

    // Get the cart from the DB using the session id
    const cart = await db.cart.findOne({ sessionId: getId(req.session.id) }).sort({ storeTitle: -1 });

    res.status(200).json({ cart: cart.cart });
});

// Updates a single product quantity
router.post('/product/updatecart', async (req, res, next) => {
    const db = req.app.db;
    const config = req.app.config;
    const cartItem = req.body;

    // Check cart exists
    if(!req.session.cart){
        emptyCart(req, res, 'json', 'No hay artículos si su carro o su carro ha caducado');
        return;
    }

    //const product = await db.products.findOne({ _id: getId(cartItem.productId) });

    const product = await db.products.aggregate([{$match: { _id: getId(cartItem.productId) }},
        {$lookup: {
            from: 'stores',
            localField: 'productStore',
            foreignField: '_id',
            as: 'searchStore'
          }},{$unwind:'$searchStore'}]).toArray();


    if(!product){
        res.status(400).json({ message: 'Se produjo un error al actualizar el carrito.', totalCartItems: Object.keys(req.session.cart).length });
        return;
    }

    // Calculate the quantity to update
    let productQuantity = cartItem.quantity ? cartItem.quantity : 1;
    if(typeof productQuantity === 'string'){
        productQuantity = parseInt(productQuantity);
    }

    if(productQuantity === 0){
        // quantity equals zero so we remove the item
        delete req.session.cart[cartItem.cartId];
        res.status(400).json({ message: 'Se produjo un error al actualizar el carro.', totalCartItems: Object.keys(req.session.cart).length });
        return;
    }

    // If stock management on check there is sufficient stock for this product
    if(config.trackStock && product.productStock){
        if(productQuantity > product.productStock){
            res.status(400).json({ message: 'No hay stock suficiente de este producto.', totalCartItems: Object.keys(req.session.cart).length });
            return;
        }
    }

    const productPrice = parseFloat(product[0].productPrice).toFixed(2);
    if(!req.session.cart[cartItem.cartId]){
        res.status(400).json({ message: 'Se produjo un error al actualizar el carro', totalCartItems: Object.keys(req.session.cart).length });
        return;
    }

    // Update the cart
    req.session.cart[cartItem.cartId].quantity = productQuantity;
    req.session.cart[cartItem.cartId].totalItemPrice = productPrice * productQuantity;

    // update total cart amount
    await updateTotalCart(req, res);

    // Update checking cart for subscription
    updateSubscriptionCheck(req, res);

    // Update cart to the DB
    await db.cart.updateOne({ sessionId: req.session.id }, {
        $set: { cart: req.session.cart }
    });


    res.status(200).json({ message: 'Carro actualizado con éxito', totalCartItems: Object.keys(req.session.cart).length });
});

// Remove single product from cart
router.post('/product/removefromcart', async (req, res, next) => {
    const db = req.app.db;

    // Check for item in cart
    if(!req.session.cart[req.body.cartId]){
        return res.status(400).json({ message: 'Producto no encontrado en el carro' });
    }

    // remove item from cart
    delete req.session.cart[req.body.cartId];

    // If not items in cart, empty it
    if(Object.keys(req.session.cart).length === 0){
        return emptyCart(req, res, 'json');
    }

    // Update cart in DB
    await db.cart.updateOne({ sessionId: req.session.id }, {
        $set: { cart: req.session.cart }
    });
    // update total cart
    await updateTotalCart(req, res);

    // Update checking cart for subscription
    updateSubscriptionCheck(req, res);

    return res.status(200).json({ message: 'Producto eliminado con éxito', totalCartItems: Object.keys(req.session.cart).length });
});

// Totally empty the cart
router.post('/product/emptycart', async (req, res, next) => {
    emptyCart(req, res, 'json');
});

// Add item to cart
router.post('/product/addtocart', async (req, res, next) => {
    const db = req.app.db;
    const config = req.app.config;
    let productQuantity = req.body.productQuantity ? parseInt(req.body.productQuantity) : 1;
    const productComment = req.body.productComment ? req.body.productComment : null;

    // If maxQuantity set, ensure the quantity doesn't exceed that value
    if(config.maxQuantity && productQuantity > config.maxQuantity){
        return res.status(400).json({
            message: 'La cantidad excede la cantidad máxima. Por favor contáctenos para pedidos más grandes.'
        });
    }

    // Don't allow negative quantity
    if(productQuantity < 1){
        productQuantity = 1;
    }

    // setup cart object if it doesn't exist
    if(!req.session.cart){
        req.session.cart = {};
    }

    // Get the product from the DB
    //const product = await db.products.findOne();

    const product = await db.products.findOne({_id: getId(req.body.productId)});

    const store = await db.stores.findOne({_id: getId(product.productStore)});

    // No product found
    if(!product){
        return res.status(400).json({ message: 'Error al actualizar el carro. Inténtalo de nuevo.' });
    }

    // If cart already has a subscription you cannot add anything else
    if(req.session.cartSubscription){
        return res.status(400).json({ message: 'Suscripción ya existente en el carro. No puedes agregar más.' });
    }

    // If existing cart isn't empty check if product is a subscription
    if(Object.keys(req.session.cart).length !== 0){
        if(product.productSubscription){
            return res.status(400).json({ message: 'No puede combinar productos de suscripción con los existentes en su carro. Vacíe su carro e intente nuevamente.' });
        }
    }

    // If stock management on check there is sufficient stock for this product
    if(config.trackStock){
        // Only if not disabled
        if(product.productStockDisable !== true){
            // If there is more stock than total (ignoring held)
            if(productQuantity > product.productStock){
                return res.status(400).json({ message: 'No hay stock suficiente de este producto.' });
            }

            const stockHeld = await db.cart.aggregate(
                {
                    $match: {
                        cart: { $elemMatch: { productId: product._id.toString() } }
                    }
                },
                { $unwind: '$cart' },
                {
                    $group: {
                        _id: '$cart.productId',
                        sumHeld: { $sum: '$cart.quantity' }
                    }
                },
                {
                    $project: {
                        sumHeld: 1
                    }
                }
            ).toArray();

            // If there is stock
            if(stockHeld.length > 0){
                const totalHeld = _.find(stockHeld, { _id: product._id.toString() }).sumHeld;
                const netStock = product.productStock - totalHeld;

                // Check there is sufficient stock
                if(productQuantity > netStock){
                    return res.status(400).json({ message: 'No hay stock suficiente de este producto.' });
                }
            }
        }
    }

    const productPrice = parseFloat(product.productPrice).toFixed(2);

    let options = {};
    if(req.body.productOptions){
        try{
            if(typeof req.body.productOptions === 'object'){
                options = req.body.productOptions;
            }else{
                options = JSON.parse(req.body.productOptions);
            }
        }catch(ex){}
    }

    // Product with options hash
    const productHash = hash({
        productId: product._id.toString(),
        options
    });

    // if exists we add to the existing value
    let cartQuantity = 0;
    if(req.session.cart[productHash]){
        cartQuantity = parseInt(req.session.cart[productHash].quantity) + productQuantity;
        req.session.cart[productHash].quantity = cartQuantity;
        req.session.cart[productHash].totalItemPrice = productPrice * parseInt(req.session.cart[productHash].quantity);
    }else{
        // Set the card quantity
        cartQuantity = productQuantity;

        // new product deets
        const productObj = {};
        productObj.productId = product._id;
        productObj.title = product.productTitle;
        productObj.quantity = productQuantity;
        productObj.totalItemPrice = productPrice * productQuantity;
        productObj.options = options;
        productObj.productImage = product.productImage;
        productObj.productComment = productComment;
        productObj.productSubscription = product.productSubscription;
        productObj.store = store.storeTitle;

        if(product.productPermalink){
            productObj.link = product.productPermalink;
        }else{
            productObj.link = product._id;
        }

        // merge into the current cart
        req.session.cart[productHash] = productObj;
    }

    // Update cart to the DB
    await db.cart.updateOne({ sessionId: req.session.id }, {
        $set: { cart: req.session.cart }
    }, { upsert: true });

    // update total cart amount
    await updateTotalCart(req, res);

    // Update checking cart for subscription
    updateSubscriptionCheck(req, res);

    if(product.productSubscription){
        req.session.cartSubscription = product.productSubscription;
    }

    return res.status(200).json({
        message: 'Carrito actualizado con éxito',
        cartId: productHash,
        totalCartItems: req.session.totalCartItems
    });
});

// search products
router.get('/search/:searchTerm/:pageNum?', (req, res) => {
    const db = req.app.db;
    const searchTerm = req.params.searchTerm;
    const productsIndex = req.app.productsIndex;
    const config = req.app.config;
    const numberProducts = config.productsPerPage ? config.productsPerPage : 6;

    const lunrIdArray = [];
    productsIndex.search(searchTerm).forEach((id) => {
        lunrIdArray.push(getId(id.ref));
    });

    let pageNum = 1;
    if(req.params.pageNum){
        pageNum = req.params.pageNum;
    }

    Promise.all([
        paginateData(true, req, pageNum, 'products', { _id: { $in: lunrIdArray } }),
        getMenu(db)
    ])
    .then(([results, menu]) => {
        // If JSON query param return json instead
        if(req.query.json === 'true'){
            res.status(200).json(results.data);
            return;
        }

        res.render(`${config.themeViews}index`, {
            title: 'Resultados',
            results: results.data,
            filtered: true,
            session: req.session,
            metaDescription: req.app.config.cartTitle + ' - Término de búsqueda: ' + searchTerm,
            searchTerm: searchTerm,
            message: clearSessionValue(req.session, 'message'),
            messageType: clearSessionValue(req.session, 'messageType'),
            productsPerPage: numberProducts,
            totalProductCount: results.totalItems,
            pageNum: pageNum,
            paginateUrl: 'search',
            config: config,
            menu: sortMenu(menu),
            helpers: req.handlebars.helpers,
            showFooter: 'showFooter'
        });
    })
    .catch((err) => {
        console.error(colors.red('Error al buscar productos', err));
    });
});

// search products
router.get('/category/:cat/:pageNum?', (req, res) => {
    const db = req.app.db;
    const searchTerm = req.params.cat;
    const productsIndex = req.app.productsIndex;
    const config = req.app.config;
    const numberProducts = config.productsPerPage ? config.productsPerPage : 6;

    const lunrIdArray = [];
    productsIndex.search(searchTerm).forEach((id) => {
        lunrIdArray.push(getId(id.ref));
    });

    let pageNum = 1;
    if(req.params.pageNum){
        pageNum = req.params.pageNum;
    }

    Promise.all([
        paginateData(true, req, pageNum, 'products', { _id: { $in: lunrIdArray } }, getSort()),
        getMenu(db)
    ])
        .then(([results, menu]) => {
            const sortedMenu = sortMenu(menu);

            // If JSON query param return json instead
            if(req.query.json === 'true'){
                res.status(200).json(results.data);
                return;
            }

            res.render(`${config.themeViews}index`, {
                title: `Category: ${searchTerm}`,
                results: results.data,
                filtered: true,
                session: req.session,
                searchTerm: searchTerm,
                metaDescription: `${req.app.config.cartTitle} - Category: ${searchTerm}`,
                message: clearSessionValue(req.session, 'message'),
                messageType: clearSessionValue(req.session, 'messageType'),
                productsPerPage: numberProducts,
                totalProductCount: results.totalItems,
                pageNum: pageNum,
                menuLink: _.find(sortedMenu.items, (obj) => { return obj.link === searchTerm; }),
                paginateUrl: 'category',
                config: config,
                menu: sortedMenu,
                helpers: req.handlebars.helpers,
                showFooter: 'showFooter'
            });
        })
        .catch((err) => {
            console.error(colors.red('Error al obtener productos para la categoría', err));
        });
});

// Language setup in cookie
router.get('/lang/:locale', (req, res) => {
    res.cookie('locale', req.params.locale, { maxAge: 900000, httpOnly: true });
    res.redirect('back');
});

// return sitemap
router.get('/sitemap.xml', (req, res, next) => {
    const sm = require('sitemap');
    const config = req.app.config;

    addSitemapProducts(req, res, (err, products) => {
        if(err){
            console.error(colors.red('Error al generar sitemap.xml', err));
        }
        const sitemap = sm.createSitemap(
            {
                hostname: config.baseUrl,
                cacheTime: 600000,
                urls: [
                    { url: '/', changefreq: 'weekly', priority: 1.0 }
                ]
            });

        const currentUrls = sitemap.urls;
        const mergedUrls = currentUrls.concat(products);
        sitemap.urls = mergedUrls;
        // render the sitemap
        sitemap.toXML((err, xml) => {
            if(err){
                return res.status(500).end();
            }
            res.header('Content-Type', 'application/xml');
            res.send(xml);
            return true;
        });
    });
});

router.get('/customer/new', async (req, res) => {
    const config = req.app.config;
    res.render(`${config.themeViews}new-customer`, {
        title: 'Registro',
        session: req.session,
        editor: true,
        helpers: req.handlebars.helpers,
        config: req.app.config
    });
});



router.get('/page/:pageNum', (req, res, next) => {
    const db = req.app.db;
    const config = req.app.config;
    const numberProducts = config.productsPerPage ? config.productsPerPage : 6;

    Promise.all([
        paginateData(true, req, req.params.pageNum, 'products', {}, getSort()),
        getMenu(db)
    ])
        .then(([results, menu]) => {
            // If JSON query param return json instead
            if(req.query.json === 'true'){
                res.status(200).json(results.data);
                return;
            }

            res.render(`${config.themeViews}index`, {
                title: 'Tienda',
                results: results.data,
                session: req.session,
                message: clearSessionValue(req.session, 'message'),
                messageType: clearSessionValue(req.session, 'messageType'),
                metaDescription: req.app.config.cartTitle + ' - Página de productos: ' + req.params.pageNum,
                config: req.app.config,
                productsPerPage: numberProducts,
                totalProductCount: results.totalItems,
                pageNum: req.params.pageNum,
                paginateUrl: 'page',
                helpers: req.handlebars.helpers,
                showFooter: 'showFooter',
                menu: sortMenu(menu)
            });
        })
        .catch((err) => {
            console.error(colors.red('Error al obtener productos para la página', err));
        });
});

// The main entry point of the shop
router.get('/:page?', async (req, res, next) => {
    const db = req.app.db;
    const config = req.app.config;
    const numberProducts = config.productsPerPage ? config.productsPerPage : 6;

    // if no page is specified, just render page 1 of the cart
    if(!req.params.page){
        Promise.all([
            paginateData(true, req, 1, 'products', {}, getSort()),
            getMenu(db)
        ])
            .then(([results, menu]) => {
                // If JSON query param return json instead
                if(req.query.json === 'true'){
                    res.status(200).json(results.data);
                    return;
                }

                res.render(`${config.themeViews}index`, {
                    title: `${config.cartTitle} - Electronica`,
                    theme: config.theme,
                    results: results.data,
                    session: req.session,
                    message: clearSessionValue(req.session, 'message'),
                    messageType: clearSessionValue(req.session, 'messageType'),
                    config,
                    productsPerPage: numberProducts,
                    totalProductCount: results.totalItems,
                    pageNum: 1,
                    paginateUrl: 'page',
                    helpers: req.handlebars.helpers,
                    showFooter: 'showFooter',
                    menu: sortMenu(menu)
                });
            })
            .catch((err) => {
                console.error(colors.red('Error al obtener productos para la página', err));
            });
    }else{
        if(req.params.page === 'admin'){
            next();
            return;
        }
        // lets look for a page
        const page = await db.pages.findOne({ pageSlug: req.params.page, pageEnabled: 'true' });
        // if we have a page lets render it, else throw 404
        if(page){
            res.render(`${config.themeViews}page`, {
                title: page.pageName,
                page: page,
                searchTerm: req.params.page,
                session: req.session,
                message: clearSessionValue(req.session, 'message'),
                messageType: clearSessionValue(req.session, 'messageType'),
                config: req.app.config,
                metaDescription: req.app.config.cartTitle + ' - ' + page,
                helpers: req.handlebars.helpers,
                showFooter: 'showFooter',
                menu: sortMenu(await getMenu(db))
            });
        }else{
            res.status(404).render('error', {
                title: '404 Error - Page not found',
                config: req.app.config,
                message: '404 Error - Page not found',
                helpers: req.handlebars.helpers,
                showFooter: 'showFooter',
                menu: sortMenu(await getMenu(db))
            });
        }
    }
});

module.exports = router;
