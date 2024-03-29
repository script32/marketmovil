const express = require('express');
const common = require('../lib/common');
const { restrict, checkAccess } = require('../lib/auth');
const { indexProducts } = require('../lib/indexing');
const { validateJson } = require('../lib/schema');
const colors = require('colors');
const rimraf = require('rimraf');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const {
    getId
} = require('../lib/common');

router.get('/admin/products/:page?', restrict, async (req, res, next) => {
    let pageNum = 1;
    if(req.params.page){
        pageNum = req.params.page;
    }

    // Get our paginated data
    const products = await common.paginateDataProduct(false, req, pageNum, 'products', {}, { productAddedDate: -1 });

    

    res.render('products', {
        title: 'Cart',
        results: products.data,
        totalItemCount: products.totalItems,
        pageNum,
        paginateUrl: 'admin/products',
        resultType: 'top',
        session: req.session,
        admin: true,
        config: req.app.config,
        message: common.clearSessionValue(req.session, 'message'),
        messageType: common.clearSessionValue(req.session, 'messageType'),
        helpers: req.handlebars.helpers
    });
});

router.get('/admin/products/filter/:search', restrict, async (req, res, next) => {
    const db = req.app.db;
    const searchTerm = req.params.search;
    const productsIndex = req.app.productsIndex;

    const lunrIdArray = [];
    productsIndex.search(searchTerm).forEach((id) => {
        lunrIdArray.push(common.getId(id.ref));
    });

    // we search on the lunr indexes
    const results = await db.products.find({ _id: { $in: lunrIdArray } }).toArray();

    if(req.apiAuthenticated){
        res.status(200).json(results);
        return;
    }

    res.render('products', {
        title: 'Results',
        results: results,
        resultType: 'filtered',
        admin: true,
        config: req.app.config,
        session: req.session,
        searchTerm: searchTerm,
        message: common.clearSessionValue(req.session, 'message'),
        messageType: common.clearSessionValue(req.session, 'messageType'),
        helpers: req.handlebars.helpers
    });
});

// insert form
router.get('/admin/product/new', restrict, checkAccess, async (req, res) => {
    const db = req.app.db;

    const storesdb = await db.stores.find().toArray();

    res.render('product-new', {
        title: 'Nuevo producto',
        session: req.session,
        productTitle: common.clearSessionValue(req.session, 'productTitle'),
        productDescription: common.clearSessionValue(req.session, 'productDescription'),
        productPrice: common.clearSessionValue(req.session, 'productPrice'),
        productPermalink: common.clearSessionValue(req.session, 'productPermalink'),
        message: common.clearSessionValue(req.session, 'message'),
        messageType: common.clearSessionValue(req.session, 'messageType'),
        editor: true,
        admin: true,
        helpers: req.handlebars.helpers,
        config: req.app.config,
        stores: storesdb
    });
});

// insert new product form action
router.post('/admin/product/insert', restrict, checkAccess, async (req, res) => {
    const db = req.app.db;

    // Process supplied options
    let productOptions = req.body.productOptions;
    if(productOptions && typeof productOptions !== 'object'){
        try{
            productOptions = JSON.parse(req.body.productOptions);
        }catch(ex){
            console.log('No analizar las opciones');
        }
    }

    const doc = {
        productPermalink: req.body.productPermalink,
        productTitle: common.cleanHtml(req.body.productTitle),
        productPrice: req.body.productPrice,
        productDescription: common.cleanHtml(req.body.productDescription),
        productPublished: common.convertBool(req.body.productPublished),
        productTags: req.body.productTags,
        productOptions: productOptions || null,
        productComment: common.checkboxBool(req.body.productComment),
        productAddedDate: new Date(),
        productStock: common.safeParseInt(req.body.productStock) || null,
        productStockDisable: common.convertBool(req.body.productStockDisable),
        productStore: getId(req.body.productStore)
    };

    // Validate the body again schema
    const schemaValidate = validateJson('newProduct', doc);
    if(!schemaValidate.result){
        console.log('schemaValidate errors', schemaValidate.errors);
        res.status(400).json(schemaValidate.errors);
        return;
    }

    // Check permalink doesn't already exist
    const product = await db.products.countDocuments({ productPermalink: req.body.productPermalink });
    if(product > 0 && req.body.productPermalink !== ''){
        res.status(400).json({ message: 'Permalink ya existe. Elige uno nuevo.' });
        return;
    }

    try{
        const newDoc = await db.products.insertOne(doc);
        // get the new ID
        const newId = newDoc.insertedId;

        // add to lunr index
        indexProducts(req.app)
        .then(() => {
            res.status(200).json({
                message: 'Nuevo producto creado con éxito',
                productId: newId
            });
        });
    }catch(ex){
        console.log(colors.red('Error al insertar documento: ' + ex));
        res.status(400).json({ message: 'Error al insertar documento' });
    }
});

// render the editor
router.get('/admin/product/edit/:id', restrict, checkAccess, async (req, res) => {
    const db = req.app.db;

    const images = await common.getImages(req.params.id, req, res);
    const product = await db.products.findOne({ _id: common.getId(req.params.id) });
    const storesdb = await db.stores.find().toArray();

    if(!product){
        // If API request, return json
        if(req.apiAuthenticated){
            res.status(400).json({ message: 'Producto no encontrado' });
            return;
        }
        req.session.message = 'Producto no encontrado';
        req.session.messageType = 'danger';
        res.redirect('/admin/products');
        return;
    }
    let options = {};
    if(product.productOptions){
        options = product.productOptions;
        if(typeof product.productOptions !== 'object'){
            options = JSON.parse(product.productOptions);
        }
    }

    // If API request, return json
    if(req.apiAuthenticated){
        res.status(200).json(product);
        return;
    }

    res.render('product-edit', {
        title: 'Editar producto',
        result: product,
        images: images,
        options: options,
        admin: true,
        session: req.session,
        message: common.clearSessionValue(req.session, 'message'),
        messageType: common.clearSessionValue(req.session, 'messageType'),
        config: req.app.config,
        editor: true,
        helpers: req.handlebars.helpers,
        stores: storesdb
    });
});

// Remove option from product
router.post('/admin/product/removeoption', restrict, checkAccess, async (req, res) => {
    const db = req.app.db;
    const product = await db.products.findOne({ _id: common.getId(req.body.productId) });
    if(product && product.productOptions){
        const opts = product.productOptions;
        delete opts[req.body.optName];

        try{
            const updateOption = await db.products.findOneAndUpdate({ _id: common.getId(req.body.productId) }, { $set: { productOptions: opts } });
            if(updateOption.ok === 1){
                res.status(200).json({ message: 'Opción eliminada con éxito' });
                return;
            }
            res.status(400).json({ message: 'Error al eliminar la opción. Inténtalo de nuevo.' });
            return;
        }catch(ex){
            res.status(400).json({ message: 'Error al eliminar la opción. Inténtalo de nuevo.' });
            return;
        }
    }
    res.status(400).json({ message: 'Producto no encontrado. Intente guardar antes de eliminar.' });
});

// Update an existing product form action
router.post('/admin/product/update', restrict, checkAccess, async (req, res) => {
    const db = req.app.db;

    const product = await db.products.findOne({ _id: common.getId(req.body.productId) });

    if(!product){
        res.status(400).json({ message: 'No se pudo actualizar el producto' });
        return;
    }
    const count = await db.products.countDocuments({ productPermalink: req.body.productPermalink, _id: { $ne: common.getId(product._id) } });
    if(count > 0 && req.body.productPermalink !== ''){
        res.status(400).json({ message: 'Permalink already exists. Pick a new one.' });
        return;
    }
    const images = await common.getImages(req.body.productId, req, res);
    // Process supplied options
    let productOptions = req.body.productOptions;
    if(productOptions && typeof productOptions !== 'object'){
        try{
            productOptions = JSON.parse(req.body.productOptions);
        }catch(ex){
            console.log('No analizar las opciones');
        }
    }
    
    const productDoc = {
        productId: req.body.productId,
        productPermalink: req.body.productPermalink,
        productTitle: common.cleanHtml(req.body.productTitle),
        productPrice: req.body.productPrice,
        productDescription: common.cleanHtml(req.body.productDescription),
        productPublished: common.convertBool(req.body.productPublished),
        productTags: req.body.productTags,
        productOptions: productOptions || null,
        productStock: common.safeParseInt(req.body.productStock) || null,
        productStockDisable: common.convertBool(req.body.productStockDisable),
        productStore: getId(req.body.productStore),

    };

    // Validate the body again schema
    const schemaValidate = validateJson('editProduct', productDoc);
    if(!schemaValidate.result){
        res.status(400).json(schemaValidate.errors);
        return;
    }

    // Remove productId from doc
    delete productDoc.productId;

    // if no featured image
    if(!product.productImage){
        if(images.length > 0){
            productDoc.productImage = images[0].path;
        }else{
            productDoc.productImage = '/uploads/placeholder.png';
        }
    }else{
        productDoc.productImage = product.productImage;
    }

    console.log(req.body.productComment);

    try{
        await db.products.updateOne({ _id: common.getId(req.body.productId) }, { $set: {"productComment": req.body.productComment}}, {});
        // Update the index
        indexProducts(req.app)
        .then(() => {
            
        });


        await db.products.updateOne({ _id: common.getId(req.body.productId) }, { $set: productDoc }, {});
        // Update the index
        indexProducts(req.app)
        .then(() => {
            res.status(200).json({ message: 'Successfully saved', product: productDoc });
        });
    }catch(ex){
        res.status(400).json({ message: 'Error al guardar. Inténtalo de nuevo' });
    }
});

// delete a product
router.post('/admin/product/delete', restrict, checkAccess, async (req, res) => {
    const db = req.app.db;

    // remove the product
    await db.products.deleteOne({ _id: common.getId(req.body.productId) }, {});

    // delete any images and folder
    rimraf('public/uploads/' + req.body.productId, (err) => {
        if(err){
            console.info(err.stack);
            res.status(400).json({ message: 'Error al eliminar producto' });
        }

        // re-index products
        indexProducts(req.app)
        .then(() => {
            res.status(200).json({ message: 'Producto eliminado con éxito' });
        });
    });
});

// update the published state based on an ajax call from the frontend
router.post('/admin/product/publishedState', restrict, checkAccess, async (req, res) => {
    const db = req.app.db;

    try{
        await db.products.updateOne({ _id: common.getId(req.body.id) }, { $set: { productPublished: common.convertBool(req.body.state) } }, { multi: false });
        res.status(200).json({ message: 'Estado publicado actualizado' });
    }catch(ex){
        console.error(colors.red('Error al actualizar el estado publicado: ' + ex));
        res.status(400).json({ message: 'Estado publicado no actualizado' });
    }
});

// set as main product image
router.post('/admin/product/setasmainimage', restrict, checkAccess, async (req, res) => {
    const db = req.app.db;

    try{
        // update the productImage to the db
        await db.products.updateOne({ _id: common.getId(req.body.product_id) }, { $set: { productImage: req.body.productImage } }, { multi: false });
        res.status(200).json({ message: 'Imagen principal configurada correctamente' });
    }catch(ex){
        res.status(400).json({ message: 'No se puede establecer como imagen principal. Inténtalo de nuevo.' });
    }
});

// deletes a product image
router.post('/admin/product/deleteimage', restrict, checkAccess, async (req, res) => {
    const db = req.app.db;

    // get the productImage from the db
    const product = await db.products.findOne({ _id: common.getId(req.body.product_id) });
    if(!product){
        res.status(400).json({ message: 'Producto no encontrado' });
        return;
    }
    if(req.body.productImage === product.productImage){
        // set the productImage to null
        await db.products.updateOne({ _id: common.getId(req.body.product_id) }, { $set: { productImage: null } }, { multi: false });

        // remove the image from disk
        fs.unlink(path.join('public', req.body.productImage), (err) => {
            if(err){
                res.status(400).json({ message: 'Imagen no eliminada, intente nuevamente.' });
            }else{
                res.status(200).json({ message: 'Imagen eliminada con éxito' });
            }
        });
    }else{
        // remove the image from disk
        fs.unlink(path.join('public', req.body.productImage), (err) => {
            if(err){
                res.status(400).json({ message: 'Imagen no eliminada, intente nuevamente.' });
            }else{
                res.status(200).json({ message: 'Imagen eliminada con éxito' });
            }
        });
    }
});

module.exports = router;
