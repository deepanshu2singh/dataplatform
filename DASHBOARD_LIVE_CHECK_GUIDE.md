# Dashboard presentation: live check

The production deployment is https://dataplatform-v1-pyg55odcz-deepanshu1927.vercel.app. User supplied alive HTTP 200 and ready HTTP 200/database ok/migrations ok. Windows backend 241 tests passed; guarded frontend tests/lint/build completed with temporary CLI maxWorkers=2/testTimeout=15000, without source/dependency edits. Browser feature acceptance is still pending.

The accompanying dashboard-presentation-check.csv contains fictional test data: 24 rows, 7 columns, January–April 2026, three regions and two products. Revenue 18,000, orders 204, profit 3,600, profit/revenue 20%. It contains no personal data. Test it in your normal app account, using a separate dashboard called Presentation Check.

## 1. Upload

1. Download dashboard-presentation-check.csv.
2. Open https://dataplatform.sprout-sql.com/datasets and sign in if required.
3. Click Upload Dataset. Set Dataset name to Dashboard Presentation Check.
4. Under CSV file choose the downloaded CSV. Click Upload Dataset and wait.
5. The dataset should show 24 rows and 7 columns. Refresh once and confirm it is still present.

## 2. Create the dashboard

Open Dashboards from the sidebar, click New Dashboard (or Create Dashboard on the empty page), and name it Presentation Check. New widgets open an Edit dialog. Every data widget below must use Dataset = Dashboard Presentation Check and Result limit = 100. The word dataset in the SQL is the selected dataset's query name: do not replace it with the file name or dataset ID.

After pasting SQL, click Load query fields. Choose/type the field names given below. Use Preview to run the query. Done closes the dialog; Save in the dashboard header persists the draft. Wait for Dashboard saved before refreshing.

## 3. Grouped/stacked charts

Add Widget → Chart. Name it Revenue by month and region. Paste:

```sql
SELECT month, region, SUM(revenue) AS revenue FROM dataset GROUP BY month, region ORDER BY month, region;
```

Set X/category column=month, Y/numeric column=revenue and Series column=region. Try each of Bar, Horizontal bar, Line, Area, Stacked bar and Stacked area, clicking Preview after changes. Each should draw real marks with four month categories and three series. Stacked totals must be1800,3600,5400,7200 from January to April. Missing or error messages are failures to report, not instructions to keep changing code.

Change Palette, Show legend, Show grid, Show data labels and axis titles, then Preview. Leave one type selected, Done and Save. If you want a separate saved card for every type, duplicate the chart and change its type; duplication must keep data/position behavior and make a distinct widget ID.

## 4. Pie and donut

Add another Chart. Use this SQL:

```sql
SELECT region, SUM(revenue) AS revenue FROM dataset GROUP BY region ORDER BY region;
```

Choose Pie, X/category=region and Y/numeric=revenue. It must have three slices: North 3,000, South 6,000, West 9,000. Switch to Donut and Preview again. Labels and legend must remain readable. Done and Save.

## 5. Scatter

Add Chart, choose Scatter and paste:

```sql
SELECT orders, revenue, region FROM dataset ORDER BY orders, region;
```

X/numeric=orders, Y/numeric=revenue, Series=region. Preview should report24 plotted rows and draw numeric X/Y axes with three region series. Some genuine points overlap; do not expect24 distinct visible locations. Done and Save.

## 6. Combo

Add Chart, choose Combo (bar + line), and paste:

```sql
SELECT month, SUM(revenue) AS revenue, SUM(orders) AS orders FROM dataset GROUP BY month ORDER BY month;
```

X/category=month, Y/numeric=revenue, Second numeric column=orders. Enable Separate right axis. Set Format=Number, Decimals=0; numeric formatting is shared, so label the left axis Revenue and right axis Orders rather than applying currency to order counts. Preview must show revenue bars 1,800/3,600/5,400/7,200 and an orders line 33/45/57/69. Done and Save.

## 7. Table controls

Add Widget → Table and use:

```sql
SELECT order_date, month, region, product, revenue, orders, profit FROM dataset ORDER BY order_date, region, product;
```

Load query fields. Set Default rows per page=10, Row spacing=Compact, Default sort column=revenue and Default sort direction=Descending. Enable Show row numbers. Under Configure column choose revenue, set width 180, alignmentRight, FormatCurrency and CurrencyGBP. Try hiding a column using Visible columns. Preview, Done and Save.

The returned result has 24 rows, so pagination must have three pages:1–10,11–20,21–24. Header sorting, rows-per-page and Reset view must work. They operate on these 24 returned rows, not on an unseen complete dataset; SQL ORDER BY is needed for ordering before a limit. In View mode, table interactions must not change the saved defaults.

## 8. Metrics

Add Widget → Metric with:

```sql
SELECT SUM(revenue) AS total_revenue FROM dataset;
```

Value column=total_revenue; Label=Total revenue; Format=Currency; Currency=GBP; Decimals=0. Preview must display £18,000. Done and Save.

Add another Metric with:

```sql
SELECT SUM(profit) / SUM(revenue) AS margin FROM dataset;
```

Value column=margin; Label=Profit margin; Format=Percent; Percent values=0.25 means 25%; Decimals=0. The SQL returns 0.2, so Preview must display 20%. Done and Save.

## 9. Saved state and readability

After the final Save, refresh the page. Reopen a chart, table and metric and confirm their settings remain. Click View in the dashboard header and compare the same values, formatting and layout. Switch Light/Dark with Appearance and check a narrow window. Drag/resize one chart/table/metric, Save and refresh; values and settings must survive. Existing lock/duplicate/Undo/Redo and stale-save draft preservation must still work.

Report: chart previews; table controls; metrics; Save/refresh; viewer match; Light/Dark; movement/resizing. Include the first exact error if any. Backend health HTTP 200 alone does not establish this acceptance. Do not begin phase C until live B acceptance and a fresh actual source checkpoint.

Dataset filters and slicers are phase C. Current table sorting/pages and chart returned-point ordering are display controls, not filters over underlying source rows. Keep the private test dataset until the requested checks are complete; cleanup is optional and is not run automatically.
