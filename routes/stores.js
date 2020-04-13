const express = require('express');
const common = require('../lib/common');
const { restrict, checkAccess } = require('../lib/auth');
const { indexStores } = require('../lib/indexing');
const { validateJson } = require('../lib/schema');
const router = express.Router();
const {
    getId,
    paginateData,
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
        storeDescription: common.cleanHtml(req.body.storeDescription),
        storeAddedDate: new Date(),
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

    if(user.userEmail !== req.session.user && req.session.isAdmin === false){
        if(req.apiAuthenticated){
            res.status(400).json({ message: 'Access denied' });
            return;
        }

        req.session.message = 'Access denied';
        req.session.messageType = 'danger';
        res.redirect('/admin/stores');
        return;
    }

    res.render('stores-edit', {
        title: 'Store edit',
        user: user,
        admin: true,
        session: req.session,
        message: common.clearSessionValue(req.session, 'message'),
        messageType: common.clearSessionValue(req.session, 'messageType'),
        helpers: req.handlebars.helpers,
        config: req.app.config
    });
});

module.exports = router;