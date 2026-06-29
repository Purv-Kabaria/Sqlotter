import * as Phaser from 'phaser';
import { AUTO, Game } from 'phaser';
import { Boot } from './scenes/Boot';
import { Preloader } from './scenes/Preloader';
import { MainMenu } from './scenes/MainMenu';
import { LevelSelect } from './scenes/LevelSelect';
import { Game as GameScene } from './scenes/Game';
import { LevelComplete } from './scenes/LevelComplete';
import { Leaderboard } from './scenes/Leaderboard';
import { Shop } from './scenes/Shop';
import { Editor } from './scenes/Editor';
import { GameOver } from './scenes/GameOver';

const config: Phaser.Types.Core.GameConfig = {
  type: AUTO,
  parent: 'game-container',
  backgroundColor: '#1a0a2e',
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  scene: [
    Boot,
    Preloader,
    MainMenu,
    LevelSelect,
    GameScene,
    LevelComplete,
    Leaderboard,
    Shop,
    Editor,
    GameOver,
  ],
};

const StartGame = (parent: string) => new Game({ ...config, parent });

document.addEventListener('DOMContentLoaded', () => {
  StartGame('game-container');
});
