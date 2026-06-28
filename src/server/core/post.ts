import { context, reddit } from '@devvit/web/server';

export const createPost = async () => {
  return await reddit.submitCustomPost({
    subredditName: context.subredditName ?? '',
    title: 'Sqlotter — The Slime Puzzle Game',
    entry: 'default',
    styles: {
      heightPixels: 512,
      backgroundColor: '#1a0a2eff',
      backgroundColorDark: '#1a0a2eff',
    },
  });
};
