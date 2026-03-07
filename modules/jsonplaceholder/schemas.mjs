import { z } from 'zod';

// Allow interpolation strings like "${step.x.response.id}" to pass schema
// validation; handlers normalize resolved values before making requests.
const interpolatableInt = z.union([z.coerce.number().int().positive(), z.string().includes('${')]);
const interpolatableBool = z.union([z.boolean(), z.string().includes('${')]);

export const ListPostsSchema = z
  .object({
    userId: interpolatableInt.optional(),
    limit: interpolatableInt.optional(),
  })
  .strict();

export const CreatePostSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  userId: interpolatableInt,
});

export const GetPostSchema = z.object({
  id: interpolatableInt,
});

export const UpdatePostSchema = z.object({
  id: interpolatableInt,
  title: z.string().min(1),
  body: z.string().min(1),
  userId: interpolatableInt,
});

export const PatchPostSchema = z.object({
  id: interpolatableInt,
  title: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  userId: interpolatableInt.optional(),
});

export const DeletePostSchema = z.object({
  id: interpolatableInt,
});

export const GetUserSchema = z
  .object({
    id: interpolatableInt,
  })
  .strict();

export const ListUserPostsSchema = z
  .object({
    userId: interpolatableInt,
  })
  .strict();

export const ListUserTodosSchema = z
  .object({
    userId: interpolatableInt,
    completed: interpolatableBool.optional(),
  })
  .strict();

export const ListUserAlbumsSchema = z
  .object({
    userId: interpolatableInt,
  })
  .strict();

export const ListPostCommentsSchema = z
  .object({
    postId: interpolatableInt,
  })
  .strict();

export const ListAlbumPhotosSchema = z
  .object({
    albumId: interpolatableInt,
  })
  .strict();
