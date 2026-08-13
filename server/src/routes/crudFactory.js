import express from 'express';
import { asyncRoute } from '../middleware/error.js';
import { refreshCache } from '../services/cache.service.js';
import { isObjectId, sanitizeObject, badRequest, notFound } from '../utils/validate.js';

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
      const q = {};
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
      res.json(item);
    })
  );

  router.post(
    '/',
    asyncRoute(async (req, res) => {
      const body = await beforeSave(sanitizeObject(req.body), null);
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
      const body = await beforeSave(sanitizeObject(req.body), existing);
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
      const updated = await Model.findByIdAndUpdate(
        req.params.id,
        { $set: sanitizeObject(req.body) },
        { new: true }
      ).lean();
      if (!updated) throw notFound();
      await afterWrite();
      res.json(updated);
    })
  );

  router.delete(
    '/:id',
    asyncRoute(async (req, res) => {
      if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
      const deleted = await Model.findByIdAndDelete(req.params.id).lean();
      if (!deleted) throw notFound();
      await afterWrite();
      res.json({ ok: true, deleted: deleted._id });
    })
  );

  return router;
}

export default crudRouter;
