/**
 * Ambient JSX type declaration for Google's <model-viewer> web component.
 *
 * @google/model-viewer registers a real custom element at runtime (imported
 * directly wherever it's used, see Model3DStage.tsx), but TypeScript has no
 * built-in knowledge of custom elements' attributes. Without this file,
 * <model-viewer ... /> in a .tsx file fails to compile with "Property
 * 'model-viewer' does not exist on type 'JSX.IntrinsicElements'".
 */

import type { DetailedHTMLProps, HTMLAttributes } from 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        alt?: string;
        poster?: string;
        loading?: 'auto' | 'lazy' | 'eager';
        reveal?: 'auto' | 'interaction' | 'manual';
        'camera-controls'?: boolean;
        'auto-rotate'?: boolean;
        'auto-rotate-delay'?: string | number;
        'rotation-per-second'?: string;
        exposure?: string | number;
        'shadow-intensity'?: string | number;
        'shadow-softness'?: string | number;
        'camera-orbit'?: string;
        'field-of-view'?: string;
        'min-camera-orbit'?: string;
        'max-camera-orbit'?: string;
        'environment-image'?: string;
        'zoom-sensitivity'?: string | number;
        ar?: boolean;
        'ar-modes'?: string;
        'disable-zoom'?: boolean;
        autoplay?: boolean;
        'animation-name'?: string;
      };
    }
  }
}

export {};