import React, { MutableRefObject, useRef, useState, useMemo, useEffect } from 'react';
import {
  ActivityIndicator,
  FlatList as FlatListType,
  FlatListProps,
  ScrollViewProps,
  StyleSheet,
  View,
  LayoutChangeEvent,
} from 'react-native';
import { FlatList } from '@stream-io/flat-list-mvcp';
import { useCallback } from 'react';

const styles = StyleSheet.create({
  indicatorContainer: {
    paddingVertical: 5,
    width: '100%',
  },
});

export type Props<T> = FlatListProps<T> & {
  /**
   * Called once when the scroll position gets close to end of list. This must return a promise.
   * You can `onEndReachedThreshold` as distance from end of list, when this function should be called.
   */
  onEndReached: () => Promise<void>;
  /**
   * Called once when the scroll position gets close to begining of list. This must return a promise.
   * You can `onStartReachedThreshold` as distance from beginning of list, when this function should be called.
   */
  onStartReached: () => Promise<void>;
  /** Color for inline loading indicator */
  activityIndicatorColor?: string;
  /** Scroll distance from beginning of list, when onStartReached should be called. */
  onStartReachedThreshold?: number;
  /**
   * Scroll distance from end of list, when onStartReached should be called.
   * Please note that this is different from onEndReachedThreshold of FlatList from react-native.
   */
  onEndReachedThreshold?: number;
  /** If true, inline loading indicators will be shown. Default - true */
  showDefaultLoadingIndicators?: boolean;
  /** Custom UI component for header inline loading indicator */
  HeaderLoadingIndicator?: React.ComponentType<any> | React.ReactElement | null;
  /** Custom UI component for footer inline loading indicator */
  FooterLoadingIndicator?: React.ComponentType<any> | React.ReactElement | null;
};

/**
 * Note:
 * - `onEndReached` and `onStartReached` must return a promise.
 * - `onEndReached` and `onStartReached` only get called once, per content length.
 * - maintainVisibleContentPosition is fixed, and can't be modified through props.
 * - doesn't accept `ListFooterComponent` via prop, since it is occupied by `FooterLoadingIndicator`.
 *    Set `showDefaultLoadingIndicators` to use `ListFooterComponent`.
 * - doesn't accept `ListHeaderComponent` via prop, since it is occupied by `HeaderLoadingIndicator`
 *    Set `showDefaultLoadingIndicators` to use `ListHeaderComponent`.
 */
export const BidirectionalFlatList = (React.forwardRef(
  <T extends any>(
    props: Props<T>,
    ref:
      | ((instance: FlatListType<T> | null) => void)
      | MutableRefObject<FlatListType<T> | null>
      | null
  ) => {
    const {
      activityIndicatorColor = 'black',
      progressViewOffset = 50,
      data: initialData,
      onLayout,
      FooterLoadingIndicator,
      HeaderLoadingIndicator,
      ListHeaderComponent,
      ListFooterComponent,
      horizontal = false,
      onContentSizeChange,
      onEndReached = () => Promise.resolve(),
      onEndReachedThreshold = 10,
      onScroll,
      onStartReached = () => Promise.resolve(),
      onStartReachedThreshold = 10,
      showDefaultLoadingIndicators = true,
      maintainVisibleContentPosition: initialMaintainVisibleContentPosition,
    } = props;
    const data = initialData ?? [];

    // States
    const [onStartReachedInProgress, setOnStartReachedInProgress] = useState(
      false
    );
    const [onEndReachedInProgress, setOnEndReachedInProgress] = useState(false);

    // Refs
    const previousData = useRef<readonly T[]>();
    const scrollMetrics = useRef<{
      offset: number,
      visibleLength: number,
      contentLength: number,
      direction: 'down' | 'up' | 'unknown',
    }>({
      offset: 0,
      visibleLength: 0,
      contentLength: 0,
      direction: 'unknown',
    });
    const onStartReachedTracker = useRef<Record<number, boolean>>({});
    const onEndReachedTracker = useRef<Record<number, boolean>>({});

    const onStartReachedInPromise = useRef<Promise<void> | null>(null);
    const onEndReachedInPromise = useRef<Promise<void> | null>(null);

    // Constants
    const maintainVisibleContentPosition = useMemo(() => {
      if (!initialMaintainVisibleContentPosition) {
        return {
          autoscrollToTopThreshold: undefined,
          minIndexForVisible: 1,
        };
      }

      return {
        autoscrollToTopThreshold: initialMaintainVisibleContentPosition.autoscrollToTopThreshold,
        minIndexForVisible: initialMaintainVisibleContentPosition.minIndexForVisible ?? 1,
      };
    }, [initialMaintainVisibleContentPosition]);

    // Callbacks
    const maybeCallOnStartReached = useCallback(() => {
      // If onStartReached has already been called for given data length, then ignore.
      if (onStartReachedTracker.current[data.length]) {
        return;
      }

      if (data.length) {
        onStartReachedTracker.current[data.length] = true;
      }

      setOnStartReachedInProgress(true);
      const p = () => {
        return new Promise<void>((resolve) => {
          onStartReachedInPromise.current = null;
          setOnStartReachedInProgress(false);
          resolve();
        });
      };

      if (onEndReachedInPromise.current) {
        onEndReachedInPromise.current.finally(() => {
          onStartReachedInPromise.current = onStartReached().then(p);
        });
      } else {
        onStartReachedInPromise.current = onStartReached().then(p);
      }
    }, [data.length]);

    const maybeCallOnEndReached = useCallback(() => {
      // If onEndReached has already been called for given data length, then ignore.
      if (onEndReachedTracker.current[data.length]) {
        return;
      }

      if (data.length) {
        onEndReachedTracker.current[data.length] = true;
      }

      setOnEndReachedInProgress(true);
      const p = () => {
        return new Promise<void>((resolve) => {
          onStartReachedInPromise.current = null;
          setOnEndReachedInProgress(false);
          resolve();
        });
      };

      if (onStartReachedInPromise.current) {
        onStartReachedInPromise.current.finally(() => {
          onEndReachedInPromise.current = onEndReached().then(p);
        });
      } else {
        onEndReachedInPromise.current = onEndReached().then(p);
      }
    }, [data.length]);

    const handleLayout = useCallback((event: LayoutChangeEvent) => {
      onLayout?.(event);

      scrollMetrics.current.visibleLength =
        !horizontal
          ? event.nativeEvent.layout.height
          : event.nativeEvent.layout.width;
    }, [onLayout, horizontal]);

    const maybeCallOnEndStartReached = useCallback(() => {
      const {offset, visibleLength, contentLength, direction} = scrollMetrics.current;

      const startThreshold = onStartReachedThreshold != null ? onStartReachedThreshold * contentLength : 2;
      const endThreshold = onEndReachedThreshold != null ? onEndReachedThreshold * contentLength : 2;
      const distanceFromEnd = contentLength - visibleLength - offset;

      const isScrollAtStart = offset <= startThreshold;
      const isScrollAtEnd = distanceFromEnd < endThreshold;

      if (isScrollAtStart && direction === 'up') {
        maybeCallOnStartReached();
      }

      if (isScrollAtEnd && direction === 'down') {
        maybeCallOnEndReached();
      }
    }, [
      maybeCallOnStartReached,
      maybeCallOnEndReached,
      onStartReachedThreshold,
      onEndReachedThreshold,
    ]);

    const handleContentSizeChange = useCallback((width: number, height: number) => {
      onContentSizeChange?.(width, height);

      if (scrollMetrics.current.visibleLength === 0) {
        scrollMetrics.current.visibleLength = !horizontal ? height : width;

        maybeCallOnEndStartReached();
      }
    }, [horizontal, onContentSizeChange, maybeCallOnEndStartReached]);

    const handleScroll: ScrollViewProps['onScroll'] = useCallback((event) => {
      const {offset: lastOffset} = scrollMetrics.current;

      onScroll?.(event);

      const offset = event.nativeEvent.contentOffset.y;
      const visibleLength = event.nativeEvent.layoutMeasurement.height;
      const contentLength = event.nativeEvent.contentSize.height;
      const direction = offset > lastOffset ? 'down' : 'up';

      scrollMetrics.current = {
        offset,
        contentLength,
        visibleLength,
        direction,
      };

      maybeCallOnEndStartReached();
    }, [
      maybeCallOnEndStartReached,
    ]);

    const renderHeaderLoadingIndicator = useCallback(() => {
      const headerElement = ListHeaderComponent ? (
        React.isValidElement(ListHeaderComponent) ? (
          ListHeaderComponent
        ) : (
          // @ts-ignore 
          <ListHeaderComponent />
        )
      ) : null;
      const loadingElement = HeaderLoadingIndicator ? (
        React.isValidElement(HeaderLoadingIndicator) ? (
          HeaderLoadingIndicator
        ) : (
          // @ts-ignore 
          <HeaderLoadingIndicator />
        )
      ) : null;

      if (!showDefaultLoadingIndicators) {
        return headerElement;
      }

      if (!onStartReachedInProgress) {
        return headerElement;
      }

      return (
        <>
          {headerElement}
          {/** @ts-ignore */}
          <View style={styles.indicatorContainer}>
            {!loadingElement ? <ActivityIndicator size={'small'} color={activityIndicatorColor} /> : loadingElement}
          </View>
        </>
      );
    }, [showDefaultLoadingIndicators, onStartReachedInProgress]);

    const renderFooterLoadingIndicator = useCallback(() => {
      const headerElement = ListFooterComponent ? (
        React.isValidElement(ListFooterComponent) ? (
          ListFooterComponent
        ) : (
          // @ts-ignore 
          <ListFooterComponent />
        )
      ) : null;
      const loadingElement = FooterLoadingIndicator ? (
        React.isValidElement(FooterLoadingIndicator) ? (
          FooterLoadingIndicator
        ) : (
          // @ts-ignore 
          <FooterLoadingIndicator />
        )
      ) : null;

      if (!showDefaultLoadingIndicators) {
        return headerElement;
      }

      if (!onEndReachedInProgress) {
        return headerElement;
      }

      return (
        <>
          {headerElement}
          {/** @ts-ignore */}
          <View style={styles.indicatorContainer}>
            {!loadingElement ? <ActivityIndicator size={'small'} color={activityIndicatorColor} /> : loadingElement}
          </View>
        </>
      );
    }, [showDefaultLoadingIndicators, onEndReachedInProgress]);

    // Keep track of previous data
    useEffect(() => {
      // Reset trackers if new data size is smaller than old one
      if (previousData.current && data.length < previousData.current.length) {
        onStartReachedTracker.current = {};
        onEndReachedTracker.current = {};
      }
    }, [data]);

    useEffect(() => {
      previousData.current = data;
    });

    return (
      <>
        <FlatList<T>
          {...props}
          ref={ref}
          onLayout={handleLayout}
          progressViewOffset={progressViewOffset}
          ListHeaderComponent={renderHeaderLoadingIndicator}
          ListFooterComponent={renderFooterLoadingIndicator}
          onEndReached={null}
          onScroll={handleScroll}
          maintainVisibleContentPosition={maintainVisibleContentPosition}
          onContentSizeChange={handleContentSizeChange}
        />
      </>
    );
  }
) as unknown) as BidirectionalFlatListType;

type BidirectionalFlatListType = <T extends any>(
  props: Props<T>
) => React.ReactElement;
