import express from 'express';
import { asyncRoute } from '../middleware/error.js';
import { refreshCache } from '../services/cache.service.js';
import { isObjectId, sanitizeObject, badRequest, notFound, forbidden } from '../utils/validate.js';
import { ownerFilter, ownerOnCreate, ownsDoc } from '../middleware/scope.js';

/**
 * Generic list/create/read/update/delete router for a Mongoose model.
 * `beforeSave(body, existingDoc)` may normalise or reject input.
 */
export function crudRouter(Model, options = {}) {
  const {
    searchFields = ['name'],
    beforeSave = async (body) => body,
    afterWrite = async () => refreshCache(),
    defaultSort = { createdAt: -1 },
    listProject = null,
  } = options;

  const router = express.Router();

  router.get(
    '/',
    asyncRoute(async (req, res) => {
      // A user only ever lists their own records; an admin lists everyone's
      const q = { ...ownerFilter(req) };
      const search = String(req.query.q || '').trim();
      if (search && searchFields.length) {
        const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        q.$or = searchFields.map((f) => ({ [f]: rx }));
      }
      if (req.query.status) q.status = String(req.query.status);
      const limit = Math.min(Number(req.query.limit) || 500, 2000);
      const items = await Model.find(q, listProject).sort(defaultSort).limit(limit).lean();
      res.json({ items, count: items.length });
    })
  );

  router.get(
    '/:id',
    asyncRoute(async (req, res) => {
      if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
      const item = await Model.findById(req.params.id).lean();
      if (!item) throw notFound();
      if (!ownsDoc(req, item)) throw forbidden();
      res.json(item);
    })
  );

  router.post(
    '/',
    asyncRoute(async (req, res) => {
      const body = await beforeSave(sanitizeObject(req.body), null);
      body.ownerId = ownerOnCreate(req, sanitizeObject(req.body));
      const created = await Model.create(body);
      await afterWrite();
      res.status(201).json(created.toObject());
    })
  );

  router.put(
    '/:id',
    asyncRoute(async (req, res) => {
      if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
      const existing = await Model.findById(req.params.id);
      if (!existing) throw notFound();
      if (!ownsDoc(req, existing)) throw forbidden();
      const body = await beforeSave(sanitizeObject(req.body), existing);
      delete body.ownerId; // reassigning an owner is not an edit
      Object.assign(existing, body);
      await existing.save();
      await afterWrite();
      res.json(existing.toObject());
    })
  );

  router.patch(
    '/:id',
    asyncRoute(async (req, res) => {
      if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
      const current = await Model.findById(req.params.id).lean();
      if (!current) throw notFound();
      if (!ownsDoc(req, current)) throw forbidden();
      const patch = sanitizeObject(req.body);
      delete patch.ownerId;
      const updated = await Model.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true }).lean();
      await afterWrite();
      res.json(updated);
    })
  );

  router.delete(
    '/:id',
    asyncRoute(async (req, res) => {
      if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
      const target = await Model.findById(req.params.id).lean();
      if (!target) throw notFound();
      if (!ownsDoc(req, target)) throw forbidden();
      const deleted = await Model.findByIdAndDelete(req.params.id).lean();
      await afterWrite();
      res.json({ ok: true, deleted: deleted._id });
    })
  );

  return router;
}

export default crudRouter;
