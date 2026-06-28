import { context, reddit } from '@devvit/web/server';

export const createPost = async () => {
  return await reddit.submitCustomPost({
    subredditName: context.subredditName ?? '',
    title: 'Splot!',
    entry: 'default',
    styles: {
      heightPixels: 512,
      backgroundColor: '#1a0a2eff',
      backgroundColorDark: '#1a0a2eff',
    },
  });
};
