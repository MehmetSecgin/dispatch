import { defineAction, defineModule } from '../../src/index.ts';
import {
  ListPostsSchema,
  CreatePostSchema,
  GetPostSchema,
  UpdatePostSchema,
  PatchPostSchema,
  DeletePostSchema,
  GetUserSchema,
  ListUserPostsSchema,
  ListUserTodosSchema,
  ListUserAlbumsSchema,
  ListPostCommentsSchema,
  ListAlbumPhotosSchema,
} from './schemas.mjs';

const BASE = 'https://jsonplaceholder.typicode.com';

function toInt(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function toOptionalInt(value, label) {
  if (value === undefined) return undefined;
  return toInt(value, label);
}

function toOptionalBoolean(value, label) {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${label} must be true or false`);
}

function buildUrl(path, query = {}) {
  const url = new URL(path, BASE);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export async function listPosts(ctx, payload) {
  const userId = toOptionalInt(payload.userId, 'userId');
  const limit = toOptionalInt(payload.limit, 'limit');
  const resp = await ctx.http.get(buildUrl('/posts', { userId, _limit: limit }));
  const response = ctx.http.requireOk(resp, 'listPosts');
  ctx.artifacts.appendActivity(`listPosts userId=${userId ?? 'all'} limit=${limit ?? 'all'}`);
  return { response, detail: `listed posts userId=${userId ?? 'all'}` };
}

export async function createPost(ctx, payload) {
  const { title, body } = payload;
  const userId = toInt(payload.userId, 'userId');
  const resp = await ctx.http.post(`${BASE}/posts`, { title, body, userId });
  const response = ctx.http.requireOk(resp, 'createPost');
  ctx.artifacts.appendActivity(`createPost userId=${userId} title="${title}"`);
  return { response, detail: `created post userId=${userId}` };
}

export async function getPost(ctx, payload) {
  const id = toInt(payload.id, 'id');
  const resp = await ctx.http.get(`${BASE}/posts/${id}`);
  const response = ctx.http.requireOk(resp, 'getPost');
  ctx.artifacts.appendActivity(`getPost id=${id}`);
  return { response, detail: `fetched post id=${id}` };
}

export async function updatePost(ctx, payload) {
  const id = toInt(payload.id, 'id');
  const userId = toInt(payload.userId, 'userId');
  const { title, body } = payload;
  const resp = await ctx.http.put(`${BASE}/posts/${id}`, { title, body, userId });
  const response = ctx.http.requireOk(resp, 'updatePost');
  ctx.artifacts.appendActivity(`updatePost id=${id} title="${title}"`);
  return { response, detail: `replaced post id=${id}` };
}

export async function patchPost(ctx, payload) {
  const id = toInt(payload.id, 'id');
  const fields = { ...payload };
  delete fields.id;
  if (fields.userId !== undefined) fields.userId = toInt(fields.userId, 'userId');
  const resp = await ctx.http.patch(`${BASE}/posts/${id}`, fields);
  const response = ctx.http.requireOk(resp, 'patchPost');
  ctx.artifacts.appendActivity(`patchPost id=${id} fields=${Object.keys(fields).join(',')}`);
  return { response, detail: `patched post id=${id}` };
}

export async function deletePost(ctx, payload) {
  const id = toInt(payload.id, 'id');
  const resp = await ctx.http.delete(`${BASE}/posts/${id}`);
  ctx.http.requireOk(resp, 'deletePost');
  const response = { deleted: true, id };
  ctx.artifacts.appendActivity(`deletePost id=${id}`);
  return { response, detail: `deleted post id=${id}` };
}

export async function getUser(ctx, payload) {
  const id = toInt(payload.id, 'id');
  const resp = await ctx.http.get(`${BASE}/users/${id}`);
  const response = ctx.http.requireOk(resp, 'getUser');
  ctx.artifacts.appendActivity(`getUser id=${id}`);
  return { response, detail: `fetched user id=${id}` };
}

export async function listUserPosts(ctx, payload) {
  const userId = toInt(payload.userId, 'userId');
  const resp = await ctx.http.get(`${BASE}/users/${userId}/posts`);
  const response = ctx.http.requireOk(resp, 'listUserPosts');
  ctx.artifacts.appendActivity(`listUserPosts userId=${userId}`);
  return { response, detail: `listed posts for user id=${userId}` };
}

export async function listUserTodos(ctx, payload) {
  const userId = toInt(payload.userId, 'userId');
  const completed = toOptionalBoolean(payload.completed, 'completed');
  const resp = await ctx.http.get(buildUrl('/todos', { userId, completed }));
  const response = ctx.http.requireOk(resp, 'listUserTodos');
  ctx.artifacts.appendActivity(`listUserTodos userId=${userId} completed=${completed ?? 'all'}`);
  return { response, detail: `listed todos for user id=${userId}` };
}

export async function listUserAlbums(ctx, payload) {
  const userId = toInt(payload.userId, 'userId');
  const resp = await ctx.http.get(`${BASE}/users/${userId}/albums`);
  const response = ctx.http.requireOk(resp, 'listUserAlbums');
  ctx.artifacts.appendActivity(`listUserAlbums userId=${userId}`);
  return { response, detail: `listed albums for user id=${userId}` };
}

export async function listPostComments(ctx, payload) {
  const postId = toInt(payload.postId, 'postId');
  const resp = await ctx.http.get(`${BASE}/posts/${postId}/comments`);
  const response = ctx.http.requireOk(resp, 'listPostComments');
  ctx.artifacts.appendActivity(`listPostComments postId=${postId}`);
  return { response, detail: `listed comments for post id=${postId}` };
}

export async function listAlbumPhotos(ctx, payload) {
  const albumId = toInt(payload.albumId, 'albumId');
  const resp = await ctx.http.get(`${BASE}/albums/${albumId}/photos`);
  const response = ctx.http.requireOk(resp, 'listAlbumPhotos');
  ctx.artifacts.appendActivity(`listAlbumPhotos albumId=${albumId}`);
  return { response, detail: `listed photos for album id=${albumId}` };
}

export default defineModule({
  name: 'jsonplaceholder',
  version: '0.2.0',
  actions: {
    'list-posts': defineAction({
      description: 'List posts with optional filtering (GET /posts)',
      schema: ListPostsSchema,
      handler: listPosts,
    }),
    'create-post': defineAction({
      description: 'Create a new post (POST /posts)',
      schema: CreatePostSchema,
      handler: createPost,
    }),
    'get-post': defineAction({
      description: 'Get a post by ID (GET /posts/:id)',
      schema: GetPostSchema,
      handler: getPost,
    }),
    'update-post': defineAction({
      description: 'Replace a post by ID (PUT /posts/:id)',
      schema: UpdatePostSchema,
      handler: updatePost,
    }),
    'patch-post': defineAction({
      description: 'Partially update a post by ID (PATCH /posts/:id)',
      schema: PatchPostSchema,
      handler: patchPost,
    }),
    'delete-post': defineAction({
      description: 'Delete a post by ID (DELETE /posts/:id)',
      schema: DeletePostSchema,
      handler: deletePost,
    }),
    'get-user': defineAction({
      description: 'Get a user by ID (GET /users/:id)',
      schema: GetUserSchema,
      handler: getUser,
    }),
    'list-user-posts': defineAction({
      description: 'List posts for a user (GET /users/:id/posts)',
      schema: ListUserPostsSchema,
      handler: listUserPosts,
    }),
    'list-user-todos': defineAction({
      description: 'List todos for a user with optional completed filter (GET /todos?userId=...)',
      schema: ListUserTodosSchema,
      handler: listUserTodos,
    }),
    'list-user-albums': defineAction({
      description: 'List albums for a user (GET /users/:id/albums)',
      schema: ListUserAlbumsSchema,
      handler: listUserAlbums,
    }),
    'list-post-comments': defineAction({
      description: 'List comments for a post (GET /posts/:id/comments)',
      schema: ListPostCommentsSchema,
      handler: listPostComments,
    }),
    'list-album-photos': defineAction({
      description: 'List photos for an album (GET /albums/:id/photos)',
      schema: ListAlbumPhotosSchema,
      handler: listAlbumPhotos,
    }),
  },
});
