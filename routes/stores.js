const express = require('express');
const common = require('../lib/common');
const { restrict, checkAccess } = require('../lib/auth');
const { indexStores } = require('../lib/indexing');
const { validateJson } = require('../lib/schema');
const router = express.Router();
const {
    getId,
    paginateData,
    getImageStore,
    clearSessionValue,
    getCountryList,
    mongoSanitize,
    sendEmail,
    clearCustomer
} = require('../lib/common');

router.get('/admin/stores', restrict, async (req, res) => {
    let pageNum = 1;
    if(req.params.page){
        pageNum = req.params.page;
    }

    const stores = await paginateData(false, req, pageNum, 'stores', {}, {});

    if(req.apiAuthenticated){
        res.status(200).json(stores);
        return;
    }

    res.render('stores', {
        title: 'Stores',
        stores: stores.data,
        admin: true,
        pageNum,
        paginateUrl: 'admin/stores',
        config: req.app.config,
        isAdmin: req.session.isAdmin,
        helpers: req.handlebars.helpers,
        session: req.session,
        message: common.clearSessionValue(req.session, 'message'),
        messageType: common.clearSessionValue(req.session, 'messageType')
    });
});

router.get('/admin/stores/filter/:search', restrict, async (req, res, next) => {
    const db = req.app.db;
    const searchTerm = req.params.search;
    const storeIndex = req.app.storeIndex;

    const lunrIdArray = [];
    storeIndex.search(searchTerm).forEach((id) => {
        lunrIdArray.push(common.getId(id.ref));
    });

    // we search on the lunr indexes
    const results = await db.stores.find({ _id: { $in: lunrIdArray } }).toArray();

    if(req.apiAuthenticated){
        res.status(200).json(results);
        return;
    }

    res.render('stores', {
        title: 'Results',
        results: results,
        resultType: 'filtered',
        admin: true,
        config: req.app.config,
        session: req.session,
        searchTerm: searchTerm,
        message: common.clearSessionValue(req.session, 'message'),
        messageType: common.clearSessionValue(req.session, 'messageType'),
        helpers: req.handlebars.helpers,
    });
});

// insert form
router.get('/admin/stores/new', restrict, (req, res) => {
    res.render('stores-new', {
        title: 'New Store',
        session: req.session,
        message: common.clearSessionValue(req.session, 'message'),
        messageType: common.clearSessionValue(req.session, 'messageType'),
        editor: true,
        admin: true,
        helpers: req.handlebars.helpers,
        config: req.app.config
    });
});

// insert new store form action
router.post('/admin/stores/insert', restrict, checkAccess, async (req, res) => {
    const db = req.app.db;
    console.log(req.body);
    // Process supplied options
    let storeOptions = req.body.storeOptions;
    if(storeOptions && typeof storeOptions !== 'object'){
        try{
            storeOptions = JSON.parse(req.body.storeOptions);
        }catch(ex){
            console.log('Failure to parse options');
        }
    }

    const doc = {
        storeTitle: common.cleanHtml(req.body.storeTitle),
        storeAddress: req.body.storeAddress,
        storeNameContact: req.body.storeNameContact,
        storeEmail: req.body.storeEmail,
        storeDescription: common.cleanHtml(req.body.storeDescription),
        storeCountry: req.body.storeCountry,
        storeState: req.body.storeState,
        storeCity: req.body.storeCity,
        storeType: req.body.storeType,
        storeAddedDate: new Date()
     };

    // Validate the body again schema
    const schemaValidate = validateJson('newStores', doc);
    if(!schemaValidate.result){
        console.log('schemaValidate errors', schemaValidate.errors);
        res.status(400).json(schemaValidate.errors);
        return;
    }

    
    try{
        const newDoc = await db.stores.insertOne(doc);
        // get the new ID
        const newId = newDoc.insertedId;
        // add to lunr index
        indexStores(req.app)
        .then(() => {
            res.status(200).json({
                message: 'New store successfully created',
                storeId: newId
            });
        });
    }catch(ex){
        console.log(colors.red('Error inserting document: ' + ex));
        res.status(400).json({ message: 'Error inserting document' });
    }
});

// edit user
router.get('/admin/stores/edit/:id', restrict, async (req, res) => {
    const db = req.app.db;
    
    const store = await db.stores.findOne({ _id: common.getId(req.params.id) });
    const images = await common.getImageStore(req.params.id, req, res);

    // Check user is found
    if(!store){
        if(req.apiAuthenticated){
            res.status(400).json({ message: 'Store not found' });
            return;
        }

        req.session.message = 'Store not found';
        req.session.messageType = 'danger';
        res.redirect('/admin/stores');
        return;
    }

    res.render('stores-edit', {
        title: 'Store edit',
        result: store,
        image: images,
        admin: true,
        session: req.session,
        message: common.clearSessionValue(req.session, 'message'),
        messageType: common.clearSessionValue(req.session, 'messageType'),
        helpers: req.handlebars.helpers,
        config: req.app.config,
        editor: true
    });
});

// Update an existing product form action
router.post('/admin/stores/update', restrict, checkAccess, async (req, res) => {
    const db = req.app.db;

    const store = await db.stores.findOne({ _id: common.getId(req.body.storeId) });

    if(!store){
        res.status(400).json({ message: 'No se pudo actualizar la Tienda' });
        return;
    }
    
    const images = await common.getImageStore(req.body.storeId, req, res);
    // Process supplied options
       
    const storeDoc = {
        storeId: req.body.storeId,
        storeTitle: common.cleanHtml(req.body.storeTitle),
        storeEmail: req.body.storeEmail,
        storeAddress: req.body.storeAddress,
        storeNameContact: req.body.storeNameContact,
        storeDescription: common.cleanHtml(req.body.storeDescription),
        storeCountry: req.body.storeCountry,
        storeState: req.body.storeState,
        storeCity: req.body.storeCity,
        storeType: req.body.storeType
    };

    // Validate the body again schema
    const schemaValidate = validateJson('editStore', storeDoc);
    if(!schemaValidate.result){
        res.status(400).json(schemaValidate.errors);
        return;
    }

    // Remove productId from doc
    delete storeDoc.storeId;

    // if no featured image
    if(!store.storeImage){
        if(images.length > 0){
            storeDoc.storeImage = images[0].path;
        }else{
            storeDoc.storeImage = '/uploads/placeholder.png';
        }
    }else{
        storeDoc.storeImage = store.storeImage;
    }

    try{
        await db.stores.updateOne({ _id: common.getId(req.body.storeId) }, { $set: storeDoc }, {});
        // Update the index
        indexStores(req.app)
        .then(() => {
            res.status(200).json({ message: 'Se Guardo Satifactoriamente', store: storeDoc });
        });
    }catch(ex){
        res.status(400).json({ message: 'Error al guardar. Inténtalo de nuevo' });
    }
});

// set as main product image
router.post('/admin/stores/setasmainimage', restrict, checkAccess, async (req, res) => {
    const db = req.app.db;

    try{
        // update the productImage to the db
        await db.stores.updateOne({ _id: common.getId(req.body.store_id) }, { $set: { storeImage: req.body.storeImage } }, { multi: false });
        res.status(200).json({ message: 'Imagen principal configurada correctamente'});
    }catch(ex){
        res.status(400).json({ message: 'No se puede establecer como imagen principal. Inténtalo de nuevo.'});
    }
});

// deletes a product image
router.post('/admin/stores/deleteimage', restrict, checkAccess, async (req, res) => {
    const db = req.app.db;

    // get the productImage from the db
    const store = await db.stores.findOne({ _id: common.getId(req.body.store_id) });
    if(!store){
        res.status(400).json({ message: 'Tienda no encontrada' });
        return;
    }
    if(req.body.storeImage === store.storeImage){
        // set the productImage to null
        await db.stores.updateOne({ _id: common.getId(req.body.store_id) }, { $set: { storeImage: null } }, { multi: false });

        // remove the image from disk
        fs.unlink(path.join('public/stores', req.body.storeImage), (err) => {
            if(err){
                res.status(400).json({ message: 'Imagen no eliminada, intente nuevamente.' });
            }else{
                res.status(200).json({ message: 'Imagen eliminada con éxito' });
            }
        });
    }else{
        // remove the image from disk
        fs.unlink(path.join('public/stores', req.body.storeImage), (err) => {
            if(err){
                res.status(400).json({ message: 'Imagen no eliminada, intente nuevamente.' });
            }else{
                res.status(200).json({ message: 'Imagen eliminada con éxito' });
            }
        });
    }
});


module.exports = router;